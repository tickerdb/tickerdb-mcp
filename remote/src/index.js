import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";
import { handleAuthorizationServerMetadata, handleProtectedResourceMetadata, handleRegister, handleToken, handleRevoke, resolveOAuthToken, } from "./oauth/handlers.js";
const SESSION_TTL_MS = 60 * 60 * 1000;
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
        let transport;
        if (sessionId && sessions.has(sessionId)) {
            const existing = sessions.get(sessionId);
            if (existing.apiKey !== apiKey) {
                return jsonError(401, "Session does not match the authenticated API key.");
            }
            existing.lastUsedAt = Date.now();
            transport = existing.transport;
        }
        else if (!sessionId && isInit) {
            transport = await createStatefulTransport(apiKey);
        }
        else {
            transport = await createStatelessTransport(apiKey);
        }
        const response = await transport.handleRequest(request);
        const headers = new Headers(response.headers);
        for (const [k, v] of Object.entries(corsHeaders())) {
            headers.set(k, v);
        }
        return new Response(response.body, {
            status: response.status,
            headers,
        });
    },
};
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
            sessions.delete(sessionId);
        }
    }
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
