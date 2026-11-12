import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTickerDbServer, type ServerOptions } from "../../shared/src/server-factory.js";
import { initApiClient } from "../../shared/src/api-client.js";
import { RemoteStore, STORE_TTL_MS } from "./store.js";
import {
  handleAuthorizationServerMetadata,
  handleProtectedResourceMetadata,
  handleAuthorize,
  handleRegister,
  handleToken,
  handleRevoke,
  resolveOAuthToken,
  type Env,
} from "./oauth/handlers.js";

export { TickerDbStore } from "./store.js";

const SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_MODE = "stateless";
const STATELESS_ALLOW_HEADER = "POST, OPTIONS";
const PUBLIC_DISCOVERY_API_KEY = "__public_discovery__";

/** Tool _meta for ChatGPT apps: every tool call needs the tickerdb OAuth scope. */
const TOOL_META: Record<string, unknown> = {
  securitySchemes: [{ type: "oauth2", scopes: ["tickerdb"] }],
};

/**
 * Worker limits for store_as / fetch_all: fewer pages than the stdio server (each
 * page is a subrequest plus a store call) and smaller /v1/history pages so a page
 * stays well inside isolate memory.
 */
const REMOTE_LIMITS = { maxPages: 200, maxRows: 1_000_000, inlineMaxChars: 40_000, historyPageRows: 10_000 };

function serverOptions(apiKey: string, env: Env): ServerOptions {
  const ttlHours = STORE_TTL_MS / 3_600_000;
  return {
    store: env.TICKERDB_STORE && apiKey !== PUBLIC_DISCOVERY_API_KEY ? new RemoteStore(env.TICKERDB_STORE, apiKey) : undefined,
    limits: REMOTE_LIMITS,
    toolMeta: TOOL_META,
    storeNote: `Tables are kept per API key and deleted ${ttlHours} h after last use; format=csv returns CSV text.`,
  };
}

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
    initApiClient(env.TICKERDB);
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

    if (
      url.pathname === "/.well-known/openai-apps-challenge" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return handleOpenAiAppsChallenge(request, env);
    }

    if (url.pathname === "/authorize") {
      return handleAuthorize(request, env);
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
    const allowPublicDiscovery =
      env.MCP_PUBLIC_DISCOVERY !== "0" &&
      isPublicDiscoveryRequest(url.pathname, request.method, isInit, rpcInfo.method) &&
      !(isInit && signsInFirst(parsedBody));

    const authHeader = request.headers.get("Authorization");
    const xApiKey = request.headers.get("x-api-key");
    const authHeadersPresent = authHeader?.startsWith("Bearer ") || !!xApiKey;
    const malformedAnonymousMcpPost =
      !authHeadersPresent && isMalformedMcpPost(url.pathname, request.method, rpcInfo.method);
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
        // With public discovery on (the default), an unsigned tools/call is answered in-band;
        // anything else unsigned gets the 401 challenge below.
        if (env.MCP_PUBLIC_DISCOVERY !== "0" && rpcInfo.method === "tools/call") {
          const response = oauthRequiredToolResponse(parsedBody, env);
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
          });
          return response;
        }

        const status = malformedAnonymousMcpPost ? 400 : 401;
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
          status,
        });

        if (malformedAnonymousMcpPost) {
          return jsonError(400, "Invalid MCP JSON-RPC request.");
        }

        return jsonError(401, "Missing Authorization header.", oauthChallengeHeaders(env));
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
        env,
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
  env,
  sessionId,
  isInit,
  sessionMode,
  requestId,
}: {
  apiKey: string;
  env: Env;
  sessionId: string | null;
  isInit: boolean;
  sessionMode: SessionMode;
  requestId: string;
}): Promise<WebStandardStreamableHTTPServerTransport> {
  if (sessionMode === "stateless") {
    return createStatelessTransport(apiKey, env);
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
    return createStatefulTransport(apiKey, env);
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

  try {
    const result = await resolveOAuthToken(bearerToken, env);
    return result?.apiKey ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[oauth] Failed to resolve bearer token:', message);
    return null;
  }
}

async function createStatefulTransport(
  apiKey: string,
  env: Env,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createTickerDbServer(apiKey, serverOptions(apiKey, env));
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
  env: Env,
): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createTickerDbServer(apiKey, serverOptions(apiKey, env));
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

/**
 * Clients that must sign in before the handshake (owner 2026-11-12): Claude.ai and ChatGPT read an
 * open initialize as "no sign-in needed", so a new connector failed its first tool call. A 401 on
 * their initialize makes them start OAuth when the connector is added. Every other client (MCP
 * directories and scanners) keeps the open initialize + tools/list; tool calls need sign-in for all.
 */
const SIGN_IN_FIRST_CLIENTS = /claude|openai|chatgpt/i;

function signsInFirst(parsedBody: unknown): boolean {
  const info = (parsedBody as { params?: { clientInfo?: { name?: unknown } } } | null)?.params?.clientInfo;
  return typeof info?.name === "string" && SIGN_IN_FIRST_CLIENTS.test(info.name);
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

  return (
    isInit ||
    rpcMethod === "notifications/initialized" ||
    rpcMethod === "tools/list"
  );
}

function isMalformedMcpPost(path: string, method: string, rpcMethod: string | null): boolean {
  if (path !== "/mcp" || method !== "POST") {
    return false;
  }

  return rpcMethod === null;
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

function handleOpenAiAppsChallenge(request: Request, env: Env): Response {
  const token = env.OPENAI_APPS_CHALLENGE_TOKEN?.trim();
  if (!token) {
    return jsonError(404, "OpenAI apps challenge token is not configured.");
  }

  return new Response(request.method === "HEAD" ? null : token, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

function oauthRequiredToolResponse(parsedBody: unknown, env: Env): Response {
  const challengeHeaders = oauthChallengeHeaders(env, {
    error: "invalid_token",
    errorDescription: "Sign in to TickerDB to continue.",
  });
  const challenge = challengeHeaders["WWW-Authenticate"];

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: getRpcId(parsedBody),
      result: {
        content: [{ type: "text", text: "Authentication required: sign in to TickerDB." }],
        _meta: { "mcp/www_authenticate": [challenge] },
        isError: true,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
        ...challengeHeaders,
      },
    },
  );
}

function getRpcId(parsedBody: unknown): string | number | null {
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return null;
  }
  if (!("id" in parsedBody)) {
    return null;
  }

  const id = parsedBody.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
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
