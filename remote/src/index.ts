import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTickerApiServer } from "../../shared/src/server-factory.js";
import {
  handleAuthorizationServerMetadata,
  handleProtectedResourceMetadata,
  handleRegister,
  handleToken,
  handleRevoke,
  resolveOAuthToken,
  type Env,
} from "./oauth/handlers.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight ─────────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ── OAuth discovery & endpoints (no auth required) ─────────────────────
    if (url.pathname === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      return withCors(handleAuthorizationServerMetadata(env));
    }

    if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      return withCors(handleProtectedResourceMetadata(env));
    }

    // Claude.ai sends users to /authorize on the MCP origin — redirect to the
    // main site's consent page which has session management and the sign-in UI.
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

    // ── MCP protocol requests (auth required) ──────────────────────────────

    // Extract Bearer token or x-api-key header (Smithery gateway)
    const authHeader = request.headers.get("Authorization");
    const xApiKey = request.headers.get("x-api-key");
    if (!authHeader?.startsWith("Bearer ") && !xApiKey) {
      return jsonError(
        401,
        "Missing Authorization header. Use: Authorization: Bearer <your_api_key>",
      );
    }

    const bearerToken = xApiKey || authHeader!.slice(7);
    let apiKey: string;

    if (bearerToken.startsWith("ta_")) {
      // Direct API key auth (local MCP clients)
      apiKey = bearerToken;
    } else {
      // OAuth access token (Claude.ai Connectors)
      const result = await resolveOAuthToken(bearerToken, env);
      if (!result) {
        return jsonError(401, "Invalid or expired OAuth token.");
      }
      apiKey = result.apiKey;
    }

    // Create a fresh MCP server per request with the user's API key
    const server = createTickerApiServer(apiKey);

    // Create a stateless Web Standard Streamable HTTP transport
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    await server.connect(transport);

    // Let the transport handle the request and return a Web Standard Response
    const response = await transport.handleRequest(request);

    // Add CORS headers to the response
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders())) {
      headers.set(k, v);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
