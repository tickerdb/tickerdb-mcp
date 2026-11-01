import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetFundHolders(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_fund_holders",
    "Which funds held a stock on one date (SEC Form N-PORT, point in time: each fund's newest portfolio filed by the date), largest positions first, plus the tracked indexes it belonged to (index_memberships) and totals over every holder (fund_count, fund_shares). Each fund's shares and value_usd are as of its own report_date, typically 2-5 months earlier. Costs 1 credit plus 1 per 100 funds beyond 100.",
    {
      ticker: z.string().describe("Stock or ETF ticker, e.g. \"AAPL\" (former symbols resolve)."),
      date: z.string().optional().describe("Date YYYY-MM-DD (default today). History depth depends on plan."),
      etf_only: z.boolean().optional().describe("true: only ETFs listed in TickerDB."),
      limit: z.number().int().min(1).max(1000).optional().describe("Funds per page, default 100, max 1000."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ ticker, date, etf_only, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/funds/holders", {
        ticker: ticker.trim().toUpperCase(),
        date,
        etf_only: etf_only?.toString(),
        limit: limit?.toString(),
        offset: offset?.toString(),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
