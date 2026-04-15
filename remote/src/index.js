import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";
import { handleAuthorizationServerMetadata, handleProtectedResourceMetadata, handleRegister, handleToken, handleRevoke, resolveOAuthToken, } from "./oauth/handlers.js";
const SESSION_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_MODE = "stateless";
class TransportResolutionError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "TransportResolutionError";
    }
}
const sessions = new Map();
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
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
        const authHeader = request.headers.get("Authorization");
        const xApiKey = request.headers.get("x-api-key");
        if (!authHeader?.startsWith("Bearer ") && !xApiKey) {
            return jsonError(401, "Missing Authorization header. Use: Authorization: Bearer <your_api_key>");
        }
        const bearerToken = xApiKey || authHeader.slice(7);
        const apiKey = await resolveApiKey(bearerToken, env);
        if (!apiKey) {
            return jsonError(401, "Invalid or expired OAuth token.");
        }
        const sessionId = request.headers.get("Mcp-Session-Id");
        const parsedBody = await maybeParseJson(request);
        const isInit = parsedBody !== undefined && isInitializeRequest(parsedBody);
        const sessionMode = getSessionMode(env);
        const rpcInfo = getRpcInfo(parsedBody);
        const requestId = crypto.randomUUID().slice(0, 8);
        const authMode = getAuthMode(bearerToken, xApiKey);
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
            knownSession: sessionId ? sessions.has(sessionId) : false,
        });
        try {
            const transport = await resolveTransport({
                apiKey,
                sessionId,
                isInit,
                sessionMode,
                requestId,
            });
            const response = await transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });
            const headers = new Headers(response.headers);
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
                status: response.status,
                responseSessionId: headers.get("mcp-session-id"),
            });
            return new Response(response.body, {
                status: response.status,
                headers,
            });
        }
        catch (error) {
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
                error: message,
            });
            if (error instanceof TransportResolutionError) {
                return jsonError(error.status, error.message);
            }
            return jsonError(500, "Internal MCP transport error.");
        }
    },
};
async function resolveTransport({ apiKey, sessionId, isInit, sessionMode, requestId, }) {
    if (sessionMode === "stateless") {
        return createStatelessTransport(apiKey);
    }
    if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
            throw new TransportResolutionError(404, `Session not found for Mcp-Session-Id ${shortId(sessionId)}.`);
        }
        if (existing.apiKey !== apiKey) {
            throw new TransportResolutionError(401, `Session ${shortId(sessionId)} does not match the authenticated API key.`);
        }
        existing.lastUsedAt = Date.now();
        return existing.transport;
    }
    if (isInit) {
        return createStatefulTransport(apiKey);
    }
    throw new TransportResolutionError(400, "Mcp-Session-Id header is required for non-initialize requests in stateful mode.");
}
async function resolveApiKey(bearerToken, env) {
    if (bearerToken.startsWith("ta_")) {
        return bearerToken;
    }
    const result = await resolveOAuthToken(bearerToken, env);
    return result?.apiKey ?? null;
}
async function createStatefulTransport(apiKey) {
    const server = createTickerDbServer(apiKey);
    let transport;
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
async function createStatelessTransport(apiKey) {
    const server = createTickerDbServer(apiKey);
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport;
}
async function maybeParseJson(request) {
    if (request.method !== "POST") {
        return undefined;
    }
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
        return undefined;
    }
    try {
        return await request.clone().json();
    }
    catch {
        return undefined;
    }
}
function pruneExpiredSessions() {
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
function getSessionMode(env) {
    return env.MCP_SESSION_MODE === "stateful" ? "stateful" : DEFAULT_SESSION_MODE;
}
function getAuthMode(bearerToken, xApiKey) {
    if (xApiKey || bearerToken.startsWith("ta_")) {
        return "api_key";
    }
    return "oauth";
}
function getRpcInfo(parsedBody) {
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        return { method: null, toolName: null };
    }
    const maybeMethod = "method" in parsedBody && typeof parsedBody.method === "string" ? parsedBody.method : null;
    let toolName = null;
    if (maybeMethod === "tools/call" &&
        "params" in parsedBody &&
        parsedBody.params &&
        typeof parsedBody.params === "object" &&
        !Array.isArray(parsedBody.params) &&
        "name" in parsedBody.params &&
        typeof parsedBody.params.name === "string") {
        toolName = parsedBody.params.name;
    }
    return { method: maybeMethod, toolName };
}
function shortId(value) {
    if (!value)
        return null;
    return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}
function logRequest(event, fields) {
    const safeFields = {
        ...fields,
        sessionId: shortId(typeof fields.sessionId === "string" ? fields.sessionId : null),
        responseSessionId: shortId(typeof fields.responseSessionId === "string" ? fields.responseSessionId : null),
    };
    console.log(`[mcp] ${event} ${JSON.stringify(safeFields)}`);
}
function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
        "Access-Control-Max-Age": "86400",
    };
}
function withCors(response) {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders())) {
        headers.set(k, v);
    }
    return new Response(response.body, {
        status: response.status,
        headers,
    });
}
function jsonError(status, message) {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
        },
    });
}
