import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createTickerDbServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: "TickerDB",
      // Keep this aligned with server.json and local/package.json so connector refreshes
      // do not see conflicting server identities for the same installation.
      version: "2.0.0",
      description: "Pre-computed financial market intelligence for AI agents. Stocks, crypto, and ETFs.",
      websiteUrl: "https://tickerdb.com",
    },
    {
      instructions: "TickerDB provides pre-computed financial market intelligence and stored EOD market data for AI agents. Use get_summary as the primary tool for ticker intelligence; use get_ohlcv when exact prices, returns, charts, or backtests are needed. Use get_search to find assets by categorical state or rank snapshots by fields such as market_cap_usd or fundamentals_pe_ratio; get_search also accepts market_* and macro_* filters to find tickers under a market or economic regime on the same date, and start/end to screen a date range. Use get_market for the market level itself: regime bands of the US equity market (market_*) and the economy (macro_*: yield curve, Fed policy, inflation, labour, growth, recession risk), their change markers, and regime changes over a date range. Use get_schema with search to look up field names and band values before querying (search=\"bull flag\", search=\"volume percentile\", category=patterns, level=market): a few hundred bytes per lookup, where the full list is about 230 KB. Use get_changes for what changed on the newest date across a list of tickers (up to 50), and get_universe to pull selected fields for every asset on one date in a single call (the input of a trading model run). For insider models (copy or inverse a CEO, director or fund), find the insider with get_insiders, then pull its disclosed trades with get_insider_trades; act at disclosed_at, never trade_date. For index or fund screens (\"S&P 500 members with garp_core_score >= 70\"), pass member_of (index id from get_indexes) or held_by (fund ticker) to get_universe or get_search: membership is point in time from SEC N-PORT fund holdings (typically 2-5 months old); get_index_members, get_fund_holdings and get_fund_holders read it directly. Use get_status (free) to learn whether a new daily or weekly release is out before re-pulling data.",
    },
  );

  registerAllTools(server, apiKey);
  return server;
}
