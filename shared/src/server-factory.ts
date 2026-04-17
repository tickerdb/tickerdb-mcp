import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createTickerDbServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: "TickerDB",
      // Keep this aligned with server.json and local/package.json so connector refreshes
      // do not see conflicting server identities for the same installation.
      version: "1.7.7",
      description: "Pre-computed financial market intelligence for AI agents. Stocks, crypto, and ETFs.",
      websiteUrl: "https://tickerdb.com",
    },
    {
      instructions: "TickerDB provides pre-computed financial market intelligence for AI agents. Use get_summary as the primary tool for any ticker question — it supports 4 modes: snapshot (default), historical snapshot (date param), historical series (start/end params), and events (field/band params). Use get_search to find assets by categorical state. Use get_schema to discover available fields and band values. Use watchlist tools to track and monitor tickers over time.",
    },
  );

  registerAllTools(server, apiKey);
  return server;
}
