import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTickerApiServer } from "tickerapi-mcp-shared";

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Extract API key from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonError(
        401,
        "Missing Authorization header. Use: Authorization: Bearer <your_api_key>",
      );
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith("tapi_")) {
      return jsonError(
        401,
        "Invalid API key format. Keys start with tapi_. Get one at https://tickerapi.ai/dashboard",
      );
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
} satisfies ExportedHandler;

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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
