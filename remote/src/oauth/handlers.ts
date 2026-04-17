/**
 * OAuth 2.1 endpoint handlers for the MCP Worker.
 *
 * Implements:
 * - GET  /.well-known/oauth-authorization-server  (RFC 8414)
 * - GET  /.well-known/oauth-protected-resource     (RFC 9728)
 * - POST /register                                 (RFC 7591 dynamic client registration)
 * - POST /token                                    (authorization_code + refresh_token grants)
 * - POST /revoke                                   (RFC 7009 token revocation)
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  createDb,
  tOAuthClients,
  tOAuthAuthorizationCodes,
  tOAuthAccessTokens,
  tOAuthRefreshTokens,
  tOAuthMcpKeys,
  type McpDB,
} from './db.js';
import { sha256, generateToken, verifyPkceS256, aesDecrypt } from './crypto.js';

const ACCESS_TOKEN_LIFETIME = 3600; // 1 hour
const REFRESH_TOKEN_LIFETIME = 30 * 24 * 3600; // 30 days

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL: string;
  SITE_URL: string; // https://tickerdb.com
  MCP_URL: string; // https://mcp.tickerdb.com
  MCP_ENCRYPTION_KEY: string; // Base64-encoded AES-256 key for oauth_mcp_keys
  MCP_SESSION_MODE?: string; // optional override: "stateless" (default) or "stateful"
}

// ── Discovery metadata ───────────────────────────────────────────────────────

export function handleAuthorizationServerMetadata(env: Env): Response {
  return jsonResponse({
    issuer: env.MCP_URL,
    authorization_endpoint: `${env.SITE_URL}/oauth/authorize`,
    token_endpoint: `${env.MCP_URL}/token`,
    registration_endpoint: `${env.MCP_URL}/register`,
    revocation_endpoint: `${env.MCP_URL}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['tickerdb'],
    service_documentation: `${env.SITE_URL}/docs`,
  });
}

export function handleProtectedResourceMetadata(env: Env): Response {
  return jsonResponse({
    resource: `${env.MCP_URL}/mcp`,
    authorization_servers: [env.MCP_URL],
    scopes_supported: ['tickerdb'],
    bearer_methods_supported: ['header'],
    resource_name: 'TickerDB MCP',
    resource_documentation: `${env.SITE_URL}/docs`,
  });
}

// ── Dynamic Client Registration (RFC 7591) ───────────────────────────────────

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'invalid_request', error_description: 'Invalid JSON body' }, 400);
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === 'string')) {
    return jsonResponse(
      { error: 'invalid_client_metadata', error_description: 'redirect_uris must be a non-empty array of strings' },
      400,
    );
  }

  // Validate redirect URIs
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri as string);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return jsonResponse(
          { error: 'invalid_client_metadata', error_description: `redirect_uri must use HTTPS: ${uri}` },
          400,
        );
      }
    } catch {
      return jsonResponse(
        { error: 'invalid_client_metadata', error_description: `Invalid redirect_uri: ${uri}` },
        400,
      );
    }
  }

  const clientId = crypto.randomUUID();
  const clientName = typeof body.client_name === 'string' ? body.client_name : null;
  const clientUri = typeof body.client_uri === 'string' ? body.client_uri : null;
  const logoUri = typeof body.logo_uri === 'string' ? body.logo_uri : null;
  const scope = typeof body.scope === 'string' ? body.scope : 'tickerdb';
  const tokenEndpointAuthMethod =
    typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';

  // Generate client_secret for confidential clients
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (tokenEndpointAuthMethod === 'client_secret_post') {
    clientSecret = generateToken();
    clientSecretHash = await sha256(clientSecret);
  }

  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code'];

  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  const now = new Date();

  await db.insert(tOAuthClients).values({
    id: crypto.randomUUID(),
    clientId,
    clientSecretHash,
    redirectUris: JSON.stringify(redirectUris),
    clientName,
    clientUri,
    logoUri,
    scope,
    grantTypes: JSON.stringify(grantTypes),
    responseTypes: JSON.stringify(responseTypes),
    tokenEndpointAuthMethod,
    createdAt: now,
  });

  const responseBody: Record<string, unknown> = {
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: clientName,
    client_uri: clientUri,
    logo_uri: logoUri,
    scope,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
  };

  if (clientSecret) {
    responseBody.client_secret = clientSecret;
    responseBody.client_secret_expires_at = 0; // never expires
  }

  return jsonResponse(responseBody, 201);
}

// ── Token Exchange ───────────────────────────────────────────────────────────

export async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let params: URLSearchParams;
  try {
    const text = await request.text();
    params = new URLSearchParams(text);
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const grantType = params.get('grant_type');
  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(params, db);
  } else if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(params, db);
  } else {
    return jsonResponse({ error: 'unsupported_grant_type' }, 400);
  }
}

async function handleAuthorizationCodeGrant(params: URLSearchParams, db: McpDB): Promise<Response> {
  const code = params.get('code');
  const clientId = params.get('client_id');
  const codeVerifier = params.get('code_verifier');
  const redirectUri = params.get('redirect_uri');

  if (!code || !clientId || !codeVerifier) {
    return jsonResponse(
      { error: 'invalid_request', error_description: 'Missing code, client_id, or code_verifier' },
      400,
    );
  }

  // Authenticate client
  const client = await authenticateClient(params, db);
  if (!client) {
    return jsonResponse({ error: 'invalid_client' }, 401);
  }

  // Look up authorization code
  const codeHash = await sha256(code);
  const now = new Date();

  const codes = await db
    .select()
    .from(tOAuthAuthorizationCodes)
    .where(
      and(
        eq(tOAuthAuthorizationCodes.codeHash, codeHash),
        eq(tOAuthAuthorizationCodes.clientId, clientId),
        gt(tOAuthAuthorizationCodes.expiresAt, now),
      ),
    )
    .limit(1);

  if (codes.length === 0) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400);
  }

  const authCode = codes[0];

  // Delete the code immediately (single-use)
  await db.delete(tOAuthAuthorizationCodes).where(eq(tOAuthAuthorizationCodes.id, authCode.id));

  // Verify PKCE
  const pkceValid = await verifyPkceS256(codeVerifier, authCode.codeChallenge);
  if (!pkceValid) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }

  // Verify redirect_uri matches if provided
  if (redirectUri && redirectUri !== authCode.redirectUri) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Issue tokens
  return issueTokens(db, authCode.clientId, authCode.userId, authCode.scope);
}

async function handleRefreshTokenGrant(params: URLSearchParams, db: McpDB): Promise<Response> {
  const refreshToken = params.get('refresh_token');
  if (!refreshToken) {
    return jsonResponse({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
  }

  // Authenticate client
  const client = await authenticateClient(params, db);
  if (!client) {
    return jsonResponse({ error: 'invalid_client' }, 401);
  }

  const tokenHash = await sha256(refreshToken);
  const now = new Date();

  const tokens = await db
    .select()
    .from(tOAuthRefreshTokens)
    .where(
      and(
        eq(tOAuthRefreshTokens.tokenHash, tokenHash),
        eq(tOAuthRefreshTokens.clientId, client.clientId),
        gt(tOAuthRefreshTokens.expiresAt, now),
        isNull(tOAuthRefreshTokens.revokedAt),
      ),
    )
    .limit(1);

  if (tokens.length === 0) {
    return jsonResponse({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }, 400);
  }

  const oldRefresh = tokens[0];

  // Revoke old refresh token (rotation)
  await db
    .update(tOAuthRefreshTokens)
    .set({ revokedAt: now })
    .where(eq(tOAuthRefreshTokens.id, oldRefresh.id));

  // Revoke the old access token too
  if (oldRefresh.accessTokenId) {
    await db
      .update(tOAuthAccessTokens)
      .set({ revokedAt: now })
      .where(eq(tOAuthAccessTokens.id, oldRefresh.accessTokenId));
  }

  // Issue new tokens
  return issueTokens(db, oldRefresh.clientId, oldRefresh.userId, oldRefresh.scope);
}

async function authenticateClient(params: URLSearchParams, db: McpDB): Promise<{ clientId: string } | null> {
  const clientId = params.get('client_id');
  if (!clientId) return null;

  const clients = await db
    .select()
    .from(tOAuthClients)
    .where(eq(tOAuthClients.clientId, clientId))
    .limit(1);

  if (clients.length === 0) return null;

  const client = clients[0];

  // For confidential clients, verify client_secret
  if (client.tokenEndpointAuthMethod === 'client_secret_post') {
    const clientSecret = params.get('client_secret');
    if (!clientSecret || !client.clientSecretHash) return null;
    const secretHash = await sha256(clientSecret);
    if (secretHash !== client.clientSecretHash) return null;
  }

  return { clientId: client.clientId };
}

async function issueTokens(
  db: McpDB,
  clientId: string,
  userId: string,
  scope: string | null,
): Promise<Response> {
  const now = new Date();

  // Generate access token
  const accessTokenRaw = generateToken();
  const accessTokenHash = await sha256(accessTokenRaw);
  const accessTokenId = crypto.randomUUID();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_LIFETIME * 1000);

  await db.insert(tOAuthAccessTokens).values({
    id: accessTokenId,
    tokenHash: accessTokenHash,
    clientId,
    userId,
    scope,
    expiresAt: accessExpiresAt,
    createdAt: now,
  });

  // Generate refresh token
  const refreshTokenRaw = generateToken();
  const refreshTokenHash = await sha256(refreshTokenRaw);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_LIFETIME * 1000);

  await db.insert(tOAuthRefreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: refreshTokenHash,
    clientId,
    userId,
    accessTokenId,
    scope,
    expiresAt: refreshExpiresAt,
    createdAt: now,
  });

  return jsonResponse({
    access_token: accessTokenRaw,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_LIFETIME,
    refresh_token: refreshTokenRaw,
    scope: scope ?? 'tickerdb',
  });
}

// ── Token Revocation (RFC 7009) ──────────────────────────────────────────────

export async function handleRevoke(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let params: URLSearchParams;
  try {
    const text = await request.text();
    params = new URLSearchParams(text);
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const token = params.get('token');
  if (!token) {
    // RFC 7009: return 200 even if token is missing
    return new Response(null, { status: 200 });
  }

  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  const tokenHash = await sha256(token);
  const now = new Date();

  // Try access tokens first
  const accessTokens = await db
    .select({ id: tOAuthAccessTokens.id })
    .from(tOAuthAccessTokens)
    .where(and(eq(tOAuthAccessTokens.tokenHash, tokenHash), isNull(tOAuthAccessTokens.revokedAt)))
    .limit(1);

  if (accessTokens.length > 0) {
    await db.update(tOAuthAccessTokens).set({ revokedAt: now }).where(eq(tOAuthAccessTokens.id, accessTokens[0].id));
    return new Response(null, { status: 200 });
  }

  // Try refresh tokens
  const refreshTokens = await db
    .select({ id: tOAuthRefreshTokens.id })
    .from(tOAuthRefreshTokens)
    .where(and(eq(tOAuthRefreshTokens.tokenHash, tokenHash), isNull(tOAuthRefreshTokens.revokedAt)))
    .limit(1);

  if (refreshTokens.length > 0) {
    await db.update(tOAuthRefreshTokens).set({ revokedAt: now }).where(eq(tOAuthRefreshTokens.id, refreshTokens[0].id));
  }

  // RFC 7009: always return 200
  return new Response(null, { status: 200 });
}

// ── Resolve OAuth token to API key ───────────────────────────────────────────

export async function resolveOAuthToken(
  token: string,
  env: Env,
): Promise<{ apiKey: string; userId: string } | null> {
  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  const tokenHash = await sha256(token);
  const now = new Date();

  // Look up valid, non-revoked, non-expired access token
  const tokens = await db
    .select({ userId: tOAuthAccessTokens.userId })
    .from(tOAuthAccessTokens)
    .where(
      and(
        eq(tOAuthAccessTokens.tokenHash, tokenHash),
        gt(tOAuthAccessTokens.expiresAt, now),
        isNull(tOAuthAccessTokens.revokedAt),
      ),
    )
    .limit(1);

  if (tokens.length === 0) return null;

  const { userId } = tokens[0];

  // Look up the user's dedicated OAuth MCP API key (stored encrypted)
  const mcpKeys = await db
    .select({ encryptedApiKey: tOAuthMcpKeys.encryptedApiKey })
    .from(tOAuthMcpKeys)
    .where(eq(tOAuthMcpKeys.userId, userId))
    .limit(1);

  if (mcpKeys.length === 0) {
    // No OAuth MCP key provisioned — user needs to re-authorize.
    // This shouldn't happen in normal flow (key is created during consent).
    return null;
  }

  // Decrypt the raw API key
  const apiKey = await aesDecrypt(mcpKeys[0].encryptedApiKey, env.MCP_ENCRYPTION_KEY);

  return { apiKey, userId };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
