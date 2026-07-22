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
  tApiKeys,
  tOAuthClients,
  tOAuthAuthorizationCodes,
  tOAuthAccessTokens,
  tOAuthRefreshTokens,
  tOAuthMcpKeys,
  type McpDB,
} from './db.js';
import { sha256, generateToken, verifyPkceS256, aesEncrypt, aesDecrypt } from './crypto.js';

const ACCESS_TOKEN_LIFETIME = 3600; // 1 hour
const REFRESH_TOKEN_LIFETIME = 30 * 24 * 3600; // 30 days

export interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL: string;
  SITE_URL: string; // https://tickerdb.com
  MCP_URL: string; // https://mcp.tickerdb.com
  MCP_ENCRYPTION_KEY: string; // Base64-encoded AES-256 key for oauth_mcp_keys
  MCP_SESSION_MODE?: string; // optional override: "stateless" (default) or "stateful"
  OPENAI_APPS_CHALLENGE_TOKEN?: string; // optional domain verification token
  TICKERDB?: { fetch: typeof fetch }; // Service binding to the tickerdb Worker
}

// ── Discovery metadata ───────────────────────────────────────────────────────

export function handleAuthorizationServerMetadata(env: Env): Response {
  return jsonResponse({
    issuer: env.MCP_URL,
    authorization_endpoint: `${env.MCP_URL}/authorize`,
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

// ── Authorization endpoint (consent UI) ─────────────────────────────────────

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return authorizeGet(request, env);
  if (request.method === 'POST') return authorizePost(request, env);
  return jsonResponse({ error: 'method_not_allowed' }, 405);
}

async function authorizeGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state') ?? '';
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const responseType = url.searchParams.get('response_type');
  const scope = url.searchParams.get('scope') ?? 'tickerdb';

  if (!clientId || !redirectUri || !codeChallenge || codeChallengeMethod !== 'S256' || responseType !== 'code') {
    return htmlError('Missing or invalid OAuth parameters.');
  }

  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
  const clients = await db.select().from(tOAuthClients).where(eq(tOAuthClients.clientId, clientId)).limit(1);
  if (clients.length === 0) return htmlError('Unknown OAuth client.');

  const client = clients[0];
  const allowedUris: string[] = JSON.parse(client.redirectUris);
  if (!allowedUris.includes(redirectUri)) return htmlError('redirect_uri not registered for this client.');

  return consentHtml({ clientName: client.clientName ?? clientId, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope });
}

async function authorizePost(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const apiKey = (form.get('api_key') as string | null)?.trim() ?? '';
  const clientId = form.get('client_id') as string | null;
  const clientName = (form.get('client_name') as string | null) ?? '';
  const redirectUri = form.get('redirect_uri') as string | null;
  const state = (form.get('state') as string | null) ?? '';
  const codeChallenge = form.get('code_challenge') as string | null;
  const codeChallengeMethod = (form.get('code_challenge_method') as string | null) ?? 'S256';
  const scope = (form.get('scope') as string | null) ?? 'tickerdb';

  if (!clientId || !redirectUri || !codeChallenge) return htmlError('Missing OAuth parameters.');

  const db = createDb(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);

  // Validate redirect_uri against client's registered URIs
  const clients = await db.select({ redirectUris: tOAuthClients.redirectUris }).from(tOAuthClients).where(eq(tOAuthClients.clientId, clientId)).limit(1);
  if (clients.length === 0) return htmlError('Unknown OAuth client.');
  const allowedUris: string[] = JSON.parse(clients[0].redirectUris);
  if (!allowedUris.includes(redirectUri)) return htmlError('redirect_uri not registered for this client.');

  const params = { clientName, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope };

  if (!apiKey.startsWith('tdb_')) {
    return consentHtml({ ...params, error: 'Invalid API key. TickerDB API keys start with tdb_.' });
  }

  // Look up API key in the DB to get userId
  const keyHash = await sha256(apiKey);
  const now = new Date();
  const keyRows = await db
    .select({ id: tApiKeys.id, userId: tApiKeys.userId })
    .from(tApiKeys)
    .where(and(eq(tApiKeys.keyHash, keyHash), isNull(tApiKeys.revokedAt)))
    .limit(1);

  if (keyRows.length === 0) {
    return consentHtml({ ...params, error: 'API key not found or has been revoked.' });
  }

  const { id: apiKeyId, userId } = keyRows[0];

  // Store (or refresh) the encrypted API key for this user
  const encryptedApiKey = await aesEncrypt(apiKey, env.MCP_ENCRYPTION_KEY);
  await db
    .insert(tOAuthMcpKeys)
    .values({ userId, apiKeyId, encryptedApiKey, createdAt: now })
    .onConflictDoUpdate({ target: tOAuthMcpKeys.userId, set: { apiKeyId, encryptedApiKey, createdAt: now } });

  // Create single-use authorization code (10-minute TTL)
  const code = generateToken();
  const codeHash = await sha256(code);
  await db.insert(tOAuthAuthorizationCodes).values({
    id: crypto.randomUUID(),
    codeHash,
    clientId,
    userId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    createdAt: now,
  });

  // Redirect back to the MCP client with the authorization code
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: callback.toString() } });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlError(msg: string): Response {
  return new Response(`<!DOCTYPE html><html><body><p>${esc(msg)}</p></body></html>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function consentHtml(params: {
  clientName: string; clientId: string; redirectUri: string; state: string;
  codeChallenge: string; codeChallengeMethod: string; scope: string; error?: string;
}): Response {
  const { clientName, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope, error } = params;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <meta name="robots" content="noindex, follow">
  <title>Authorize - TickerDB</title>
  <link rel="icon" type="image/svg+xml" href="https://tickerdb.com/tickerdb-icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&amp;family=Orbitron:wght@700&amp;family=Space+Grotesk:wght@400;500;600&amp;display=swap" rel="stylesheet">
  <link rel="preload" href="https://tickerdb.com/signin.avif" as="image" type="image/avif">
  <style>
    :root {
      --bg-color: #0c0522;
      --text-color: #e8e4f0;
      --text-secondary: #c2bbd6;
      --text-tertiary: #8a8499;
      --accent: #483df8;
      --accent-hover: #5a4fff;
      --danger: #f87171;
      --font-main: 'Space Grotesk', system-ui, -apple-system, sans-serif;
      --font-heading: 'Orbitron', 'Space Grotesk', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --radius-sm: 2px;
      --clip-corner-btn: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body { min-height: 100%; }

    body {
      background: var(--bg-color);
      color: var(--text-color);
      font-family: var(--font-main);
      font-size: 0.925rem;
      line-height: 1.65;
      letter-spacing: -0.01em;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
      -webkit-tap-highlight-color: transparent;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      opacity: 0.035;
      pointer-events: none;
      z-index: 9999;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-repeat: repeat;
      background-size: 256px 256px;
    }

    .auth-page {
      height: 100vh;
      height: 100dvh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .auth-bg {
      position: absolute;
      inset: 0;
      background: url('https://tickerdb.com/signin.png') top center / cover no-repeat;
      background: image-set(url('https://tickerdb.com/signin.avif') type('image/avif'), url('https://tickerdb.com/signin.png') type('image/png')) top center / cover no-repeat;
      filter: brightness(0.48) saturate(0.95);
      z-index: 0;
      animation: hero-breathe 10s ease-in-out infinite;
    }

    @keyframes hero-breathe {
      0%, 100% { filter: brightness(0.46) saturate(0.86); }
      50% { filter: brightness(0.64) saturate(1.08); }
    }

    .shooting-stars {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
      pointer-events: none;
    }

    .auth-overlay {
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, rgba(12, 5, 34, 0.32) 0%, rgba(12, 5, 34, 0.58) 100%);
      z-index: 2;
    }

    .auth-center {
      position: relative;
      z-index: 3;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
    }

    .auth-container {
      width: 100%;
      max-width: 320px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .auth-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .auth-tag {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: #c084fc;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
    }

    .auth-title {
      font-family: var(--font-heading);
      font-size: 1.6rem;
      color: var(--text-color);
      line-height: 1.15;
      font-weight: 700;
    }

    .auth-subtitle {
      color: var(--text-secondary);
      font-size: 0.875rem;
      line-height: 1.55;
      margin-top: 2px;
    }

    .client-name { color: #c084fc; font-weight: 500; }

    form { width: 100%; }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    .field label {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 500;
      color: var(--text-tertiary);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .field input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.09);
      color: var(--text-color);
      font-family: var(--font-mono);
      font-size: 0.9rem;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }

    .field input:focus {
      background: rgba(255, 255, 255, 0.11);
      border-color: rgba(192, 132, 252, 0.35);
      box-shadow: 0 0 0 3px rgba(192, 132, 252, 0.07);
    }

    .field input::placeholder { color: var(--text-tertiary); opacity: 0.65; }

    .hint {
      color: var(--text-tertiary);
      font-size: 0.7rem;
      line-height: 1.5;
      margin-top: 2px;
      opacity: 0.7;
    }

    .hint a { color: inherit; text-underline-offset: 2px; }
    .hint a:hover { color: var(--text-color); }

    .error {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.07);
      color: var(--danger);
      font-size: 0.82rem;
      line-height: 1.4;
      border-left: 2px solid var(--danger);
      margin-bottom: 16px;
    }

    .btn-submit {
      width: 100%;
      padding: 10px 16px;
      border: none;
      background: var(--accent);
      color: #fff;
      font-family: var(--font-main);
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      clip-path: var(--clip-corner-btn);
      transition: background 0.15s, filter 0.15s;
      letter-spacing: -0.01em;
    }

    .btn-submit:hover:not(:disabled) {
      background: var(--accent-hover);
      filter: drop-shadow(0 0 12px rgba(104, 35, 148, 0.5));
    }

    .btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }

    .auth-branding {
      position: absolute;
      top: 2rem;
      left: 2rem;
      z-index: 3;
    }

    .panel-brand { display: inline-block; text-decoration: none; }
    .panel-logo { height: 29px; width: auto; display: block; }

    @media (max-width: 480px) {
      .auth-center { padding: 5rem 1.25rem 2rem; }
      .auth-branding { top: 1.25rem; left: 1.25rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .auth-bg { animation: none; }
      .shooting-stars { display: none; }
    }
  </style>
</head>
<body>
  <div class="auth-page">
    <div class="auth-bg" aria-hidden="true"></div>
    <canvas class="shooting-stars" aria-hidden="true"></canvas>
    <div class="auth-overlay" aria-hidden="true"></div>

    <div class="auth-center">
      <main class="auth-container">
        <header class="auth-header">
          <div class="auth-tag">// authorize</div>
          <h1 class="auth-title">Authorize access</h1>
          <p class="auth-subtitle"><strong class="client-name">${esc(clientName)}</strong> is requesting access to your TickerDB account.</p>
        </header>

        <form id="authorize-form" method="POST" action="/authorize">
          <input type="hidden" name="client_id" value="${esc(clientId)}">
          <input type="hidden" name="client_name" value="${esc(clientName)}">
          <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
          <input type="hidden" name="state" value="${esc(state)}">
          <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">
          <input type="hidden" name="code_challenge_method" value="${esc(codeChallengeMethod)}">
          <input type="hidden" name="scope" value="${esc(scope)}">

          ${error ? `<p class="error">${esc(error)}</p>` : ''}

          <div class="field">
            <label for="api_key">TickerDB API key</label>
            <input type="text" id="api_key" name="api_key" placeholder="tdb_..." autocomplete="off" spellcheck="false" required autofocus>
            <p class="hint">Find your API key in <a href="https://tickerdb.com/dashboard/keys" target="_blank" rel="noreferrer">TickerDB settings &rarr; API Keys</a>.</p>
          </div>

          <button type="submit" class="btn-submit" id="authorize-btn">Authorize</button>
        </form>
      </main>
    </div>

    <div class="auth-branding">
      <a href="https://tickerdb.com" class="panel-brand" aria-label="TickerDB home">
        <img src="https://tickerdb.com/tickerdb-logo.svg" alt="TickerDB" class="panel-logo">
      </a>
    </div>
  </div>

  <script>
    (() => {
      const form = document.getElementById('authorize-form');
      const button = document.getElementById('authorize-btn');
      form.addEventListener('submit', () => {
        button.disabled = true;
        button.textContent = 'Authorizing...';
      });

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const canvas = document.querySelector('.shooting-stars');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let width = 0;
      let height = 0;
      const stars = [];
      const maxStars = 8;
      let lastSpawn = performance.now();

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = rect.width;
        height = rect.height;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      const spawnStar = () => {
        const goRight = Math.random() > 0.5;
        const speed = 0.3 + Math.random() * 0.5;
        return {
          x: goRight ? -20 : width + 20,
          y: 40 + Math.random() * Math.max(40, height * 0.38 - 40),
          vx: goRight ? speed : -speed,
          vy: (Math.random() - 0.4) * 0.15,
          size: 1 + Math.random() * 1.2,
          opacity: 0.1 + Math.random() * 0.18,
          maxY: height * 0.38,
          tail: 30 + Math.random() * 40
        };
      };

      resize();
      window.addEventListener('resize', resize, { passive: true });

      for (let i = 0; i < 4; i += 1) {
        const star = spawnStar();
        const progress = 0.2 + Math.random() * 0.4;
        star.x = star.vx > 0 ? width * progress : width * (1 - progress);
        stars.push(star);
      }

      const animate = (now) => {
        ctx.clearRect(0, 0, width, height);

        if (now - lastSpawn > 1250 + Math.random() * 2000 && stars.length < maxStars) {
          stars.push(spawnStar());
          lastSpawn = now;
        }

        for (let index = stars.length - 1; index >= 0; index -= 1) {
          const star = stars[index];
          star.x += star.vx;
          star.y += star.vy;

          if (star.x < -60 || star.x > width + 60 || star.y < -20 || star.y > star.maxY + 40) {
            stars.splice(index, 1);
            continue;
          }

          const gradient = ctx.createLinearGradient(
            star.x - star.vx * star.tail,
            star.y - star.vy * star.tail,
            star.x,
            star.y
          );
          gradient.addColorStop(0, 'rgba(200, 190, 230, 0)');
          gradient.addColorStop(1, 'rgba(200, 190, 230, ' + star.opacity + ')');

          ctx.beginPath();
          ctx.moveTo(star.x - star.vx * star.tail, star.y - star.vy * star.tail);
          ctx.lineTo(star.x, star.y);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = star.size;
          ctx.lineCap = 'round';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(210, 200, 240, ' + star.opacity * 0.8 + ')';
          ctx.fill();
        }

        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    })();
  </script>
</body>
</html>`;
  return new Response(html, { status: error ? 400 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
    ...(clientName !== null && { client_name: clientName }),
    ...(clientUri !== null && { client_uri: clientUri }),
    ...(logoUri !== null && { logo_uri: logoUri }),
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
