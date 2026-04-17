import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";
import {
  handleAuthorizationServerMetadata,
  handleProtectedResourceMetadata,
  handleRegister,
  handleToken,
  handleRevoke,
  resolveOAuthToken,
  type Env,
} from "./oauth/handlers.js";

const SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_MODE = "stateless";
const STATELESS_ALLOW_HEADER = "POST, OPTIONS";
const PUBLIC_DISCOVERY_API_KEY = "__public_discovery__";

type SessionMode = "stateless" | "stateful";
type AuthMode =
  | "api_key"
  | "oauth"
  | "public_discovery"
  | "missing_auth"
  | "invalid_oauth";

type RpcInfo = {
  method: string | null;
  toolName: string | null;
  toolMode: string | null;
  summaryField: string | null;
};

type SessionEntry = {
  apiKey: string;
  transport: WebStandardStreamableHTTPServerTransport;
  lastUsedAt: number;
};

class TransportResolutionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TransportResolutionError";
  }
}

const sessions = new Map<string, SessionEntry>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionMode = getSessionMode(env);
    pruneExpiredSessions();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      return withCors(handleAuthorizationServerMetadata(env));
    }

    if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      return withCors(handleProtectedResourceMetadata(env));
    }

    if (url.pathname === "/.well-known/oauth-protected-resource/mcp" && request.method === "GET") {
      return withCors(handleProtectedResourceMetadata(env));
    }

    if (url.pathname === "/.well-known/openid-configuration" && request.method === "GET") {
      return jsonError(404, "OpenID configuration is not supported.");
    }

    if (url.pathname === "/authorize") {
      const authorizeUrl = new URL(`${env.SITE_URL}/oauth/authorize`);
      url.searchParams.forEach((v, k) => authorizeUrl.searchParams.set(k, v));
      return new Response(null, { status: 302, headers: { Location: authorizeUrl.toString() } });
    }

    if (url.pathname === "/register") {
      return withCors(await handleRegister(request, env));
    }

    if (url.pathname === "/token") {
      return withCors(await handleToken(request, env));
    }

    if (url.pathname === "/revoke") {
      return withCors(await handleRevoke(request, env));
    }

    if (url.pathname === "/mcp" && sessionMode === "stateless") {
      if (request.method === "GET" || request.method === "DELETE") {
        return methodNotAllowed(STATELESS_ALLOW_HEADER);
      }
      if (request.method === "HEAD") {
        return headMethodNotAllowed(STATELESS_ALLOW_HEADER);
      }
    }

    const sessionId = request.headers.get("Mcp-Session-Id");
    const parsedBody = await maybeParseJson(request);
    const isInit = parsedBody !== undefined && isInitializeRequest(parsedBody);
    const rpcInfo = getRpcInfo(parsedBody);
    const requestId = crypto.randomUUID().slice(0, 8);
    const allowPublicDiscovery = isPublicDiscoveryRequest(url.pathname, request.method, isInit, rpcInfo.method);

    const authHeader = request.headers.get("Authorization");
    const xApiKey = request.headers.get("x-api-key");
    const authHeadersPresent = authHeader?.startsWith("Bearer ") || !!xApiKey;
    let authMode: AuthMode;
    let apiKey: string;

    if (!authHeadersPresent) {
      authMode = allowPublicDiscovery ? "public_discovery" : "missing_auth";
      logRequest("start", {
        requestId,
        path: url.pathname,
        method: request.method,
        authMode,
        sessionMode,
        sessionId,
        isInit,
        rpcMethod: rpcInfo.method,
        toolName: rpcInfo.toolName,
        toolMode: rpcInfo.toolMode,
        summaryField: rpcInfo.summaryField,
        knownSession: sessionId ? sessions.has(sessionId) : false,
      });

      if (!allowPublicDiscovery) {
        logRequest("finish", {
          requestId,
          path: url.pathname,
          method: request.method,
          authMode,
          sessionMode,
          sessionId,
          isInit,
          rpcMethod: rpcInfo.method,
          toolName: rpcInfo.toolName,
          toolMode: rpcInfo.toolMode,
          summaryField: rpcInfo.summaryField,
          status: 401,
        });

        return jsonError(
          401,
          "Missing Authorization header.",
          oauthChallengeHeaders(env),
        );
      }

      apiKey = PUBLIC_DISCOVERY_API_KEY;
    } else {
      const bearerToken = xApiKey || authHeader!.slice(7);
      apiKey = (await resolveApiKey(bearerToken, env)) ?? "";
      authMode = apiKey ? getAuthMode(bearerToken, xApiKey) : "invalid_oauth";

      logRequest("start", {
        requestId,
        path: url.pathname,
        method: request.method,
        authMode,
        sessionMode,
        sessionId,
        isInit,
        rpcMethod: rpcInfo.method,
        toolName: rpcInfo.toolName,
        toolMode: rpcInfo.toolMode,
        summaryField: rpcInfo.summaryField,
        knownSession: sessionId ? sessions.has(sessionId) : false,
      });

      if (!apiKey) {
        logRequest("finish", {
          requestId,
          path: url.pathname,
          method: request.method,
          authMode,
          sessionMode,
          sessionId,
          isInit,
          rpcMethod: rpcInfo.method,
          toolName: rpcInfo.toolName,
          toolMode: rpcInfo.toolMode,
          summaryField: rpcInfo.summaryField,
          status: 401,
        });
        return jsonError(
          401,
          "Invalid or expired OAuth token.",
          oauthChallengeHeaders(env, {
            error: "invalid_token",
            errorDescription: "The access token is missing, expired, or invalid.",
          }),
        );
      }
    }

    try {
      const transport = await resolveTransport({
        apiKey,
        sessionId,
        isInit,
        sessionMode,
        requestId,
      });
      const response = await transport.handleRequest(
        request,
        parsedBody === undefined ? undefined : { parsedBody },
      );

      const headers = new Headers(response.headers);
      if (sessionMode === "stateless") {
        headers.delete("mcp-session-id");
      }
      for (const [k, v] of Object.entries(corsHeaders())) {
        headers.set(k, v);
      }

      logRequest("finish", {
        requestId,
        path: url.pathname,
        method: request.method,
        authMode,
        sessionMode,
        sessionId,
        isInit,
        rpcMethod: rpcInfo.method,
        toolName: rpcInfo.toolName,
        toolMode: rpcInfo.toolMode,
        summaryField: rpcInfo.summaryField,
        status: response.status,
        responseSessionId: headers.get("mcp-session-id"),
      });

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRequest("error", {
        requestId,
        path: url.pathname,
        method: request.method,
        authMode,
        sessionMode,
        sessionId,
        isInit,
        rpcMethod: rpcInfo.method,
        toolName: rpcInfo.toolName,
        toolMode: rpcInfo.toolMode,
        summaryField: rpcInfo.summaryField,
        error: message,
      });
      if (error instanceof TransportResolutionError) {
        return jsonError(error.status, error.message);
      }
      return jsonError(500, "Internal MCP transport error.");
    }
  },
} satisfies ExportedHandler<Env>;

async function resolveTransport({
  apiKey,
  sessionId,
  isInit,
  sessionMode,
  requestId,
}: {
  apiKey: string;
  sessionId: string | null;
  isInit: boolean;
  sessionMode: SessionMode;
  requestId: string;
}): Promise<WebStandardStreamableHTTPServerTransport> {
  if (sessionMode === "stateless") {
    return createStatelessTransport(apiKey);
  }

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      throw new TransportResolutionError(
        404,
        `Session not found for Mcp-Session-Id ${shortId(sessionId)}.`,
      );
    }
    if (existing.apiKey !== apiKey) {
      throw new TransportResolutionError(
        401,
        `Session ${shortId(sessionId)} does not match the authenticated API key.`,
      );
    }
    existing.lastUsedAt = Date.now();
    return existing.transport;
  }

  if (isInit) {
    return createStatefulTransport(apiKey);
  }

  throw new TransportResolutionError(
    400,
    "Mcp-Session-Id header is required for non-initialize requests in stateful mode.",
  );
}

async function resolveApiKey(bearerToken: string, env: Env): Promise<string | null> {
  if (bearerToken.startsWith("tdb_")) {
    return bearerToken;
  }

  const result = await resolveOAuthToken(bearerToken, env);
  return result?.apiKey ?? null;
}

async function createStatefulTransport(
  apiKey: string,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createTickerDbServer(apiKey);
  let transport!: WebStandardStreamableHTTPServerTransport;

  transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, {
        apiKey,
        transport,
        lastUsedAt: Date.now(),
      });
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  await server.connect(transport);
  return transport;
}

async function createStatelessTransport(
  apiKey: string,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createTickerDbServer(apiKey);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport;
}

async function maybeParseJson(request: Request): Promise<unknown | undefined> {
  if (request.method !== "POST") {
    return undefined;
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }

  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function pruneExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastUsedAt < cutoff) {
      logRequest("prune", {
        sessionId,
        reason: "ttl_expired",
      });
      sessions.delete(sessionId);
    }
  }
}

function getSessionMode(env: Env): SessionMode {
  return env.MCP_SESSION_MODE === "stateful" ? "stateful" : DEFAULT_SESSION_MODE;
}

function getAuthMode(bearerToken: string, xApiKey: string | null): "api_key" | "oauth" {
  if (xApiKey || bearerToken.startsWith("tdb_")) {
    return "api_key";
  }
  return "oauth";
}

function isPublicDiscoveryRequest(
  path: string,
  method: string,
  isInit: boolean,
  rpcMethod: string | null,
): boolean {
  if (path !== "/mcp" || method !== "POST") {
    return false;
  }

  return isInit || rpcMethod === "tools/list";
}

function getRpcInfo(parsedBody: unknown): RpcInfo {
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return { method: null, toolName: null, toolMode: null, summaryField: null };
  }

  const maybeMethod =
    "method" in parsedBody && typeof parsedBody.method === "string" ? parsedBody.method : null;

  let toolName: string | null = null;
  let toolMode: string | null = null;
  let summaryField: string | null = null;
  if (
    maybeMethod === "tools/call" &&
    "params" in parsedBody &&
    parsedBody.params &&
    typeof parsedBody.params === "object" &&
    !Array.isArray(parsedBody.params) &&
    "name" in parsedBody.params &&
    typeof parsedBody.params.name === "string"
  ) {
    toolName = parsedBody.params.name;

    if (
      toolName === "get_summary" &&
      "arguments" in parsedBody.params &&
      parsedBody.params.arguments &&
      typeof parsedBody.params.arguments === "object" &&
      !Array.isArray(parsedBody.params.arguments)
    ) {
      const args = parsedBody.params.arguments as Record<string, unknown>;
      if (typeof args.field === "string" && args.field.length > 0) {
        toolMode = "events";
        summaryField = args.field;
      } else if (
        typeof args.start === "string" ||
        typeof args.end === "string" ||
        typeof args.sample === "string"
      ) {
        toolMode = "series";
      } else if (typeof args.date === "string") {
        toolMode = "historical_snapshot";
      } else {
        toolMode = "snapshot";
      }
    }
  }

  return { method: maybeMethod, toolName, toolMode, summaryField };
}

function shortId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function logRequest(
  event: "start" | "finish" | "error" | "prune",
  fields: Record<string, unknown>,
): void {
  const safeFields = {
    ...fields,
    sessionId: shortId(typeof fields.sessionId === "string" ? fields.sessionId : null),
    responseSessionId: shortId(
      typeof fields.responseSessionId === "string" ? fields.responseSessionId : null,
    ),
  };
  console.log(`[mcp] ${event} ${JSON.stringify(safeFields)}`);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Authorization, Mcp-Session-Id",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function jsonError(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function oauthChallengeHeaders(
  env: Env,
  options?: { error?: string; errorDescription?: string },
): Record<string, string> {
  const challengeParts = [
    `Bearer realm="TickerDB MCP"`,
    `resource_metadata="${env.MCP_URL}/.well-known/oauth-protected-resource/mcp"`,
    `scope="tickerdb"`,
  ];

  if (options?.error) {
    challengeParts.push(`error="${escapeHeaderValue(options.error)}"`);
  }

  if (options?.errorDescription) {
    challengeParts.push(
      `error_description="${escapeHeaderValue(options.errorDescription)}"`,
    );
  }

  return {
    "WWW-Authenticate": challengeParts.join(", "),
  };
}

function escapeHeaderValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: { message: "Method not allowed." } }), {
    status: 405,
    headers: {
      Allow: allow,
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function headMethodNotAllowed(allow: string): Response {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: allow,
      ...corsHeaders(),
    },
  });
}
