import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createTickerDbServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: "TickerDB",
      // Keep this aligned with server.json and local/package.json so connector refreshes
      // do not see conflicting server identities for the same installation.
      version: "1.9.0",
      description: "Pre-computed financial market intelligence for AI agents. Stocks, crypto, and ETFs.",
      websiteUrl: "https://tickerdb.com",
    },
    {
      instructions: "TickerDB provides pre-computed financial market intelligence and stored EOD market data for AI agents. Use get_summary as the primary tool for ticker intelligence; use get_ohlcv when exact prices, returns, charts, or backtests are needed. Use get_search to find assets by categorical state or rank snapshots by fields such as market_cap. Use get_schema to discover available fields and band values.",
    },
  );

  registerAllTools(server, apiKey);
  return server;
}
