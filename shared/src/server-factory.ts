import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createTickerDbServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: "TickerDB",
      // Keep this aligned with server.json and local/package.json so connector refreshes
      // do not see conflicting server identities for the same installation.
      version: "1.10.0",
      description: "Pre-computed financial market intelligence for AI agents. Stocks, crypto, and ETFs.",
      websiteUrl: "https://tickerdb.com",
    },
    {
      instructions: "TickerDB provides pre-computed financial market intelligence and stored EOD market data for AI agents. Use get_summary as the primary tool for ticker intelligence; use get_ohlcv when exact prices, returns, charts, or backtests are needed. Use get_search to find assets by categorical state or rank snapshots by fields such as market_cap_usd or fundamentals_pe_ratio; get_search also accepts market_* and macro_* filters to find tickers under a market or economic regime on the same date, and start/end to screen a date range. Use get_market for the market level itself: regime bands of the US equity market (market_*) and the economy (macro_*: yield curve, Fed policy, inflation, labour, growth, recession risk), their change markers, and regime changes over a date range. Use get_schema to discover available fields (level ticker or market) and band values. Use get_watchlist for an overview across every ticker the user already tracks, get_watchlist_changes when the question is only what moved since the last run or over the past week, and get_summary when the question is about one specific ticker. Only call add_to_watchlist or remove_from_watchlist when the user explicitly asks to start or stop tracking a ticker.",
    },
  );

  registerAllTools(server, apiKey);
  return server;
}
