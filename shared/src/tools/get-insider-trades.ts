import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetInsiderTrades(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_insider_trades",
    "One insider's disclosed transactions (SEC Form 4), ordered by disclosure time: the event series of a copy/inverse insider model. Get the slug from get_insiders first. Two rules for backtests: act at disclosed_at (when it became public), never trade_date (up to lag_days earlier; using it is look-ahead); and only open-market trades are decisions: set open_market_only=true to drop grants, option exercises, tax withholding and gifts, and consider exclude_planned=true (pre-scheduled Rule 10b5-1 sales carry little signal; nearly all of Jeff Bezos's Amazon sales are planned). Each trade has ticker (as of disclosure), side, shares, price, value, shares_owned_after, planned, late and an sec_url. Join to get_ohlcv for prices.",
    {
      insider: z.string().describe("Insider slug from get_insiders, e.g. \"jeffrey-p-bezos\"."),
      start: z.string().optional().describe("First disclosure date YYYY-MM-DD (default: start of the plan's history)."),
      end: z.string().optional().describe("Last disclosure date YYYY-MM-DD (default: today)."),
      ticker: z.string().optional().describe("Only transactions in this company, e.g. \"AMZN\"."),
      open_market_only: z.boolean().optional().describe("true: only open-market purchases and sales (P/S)."),
      exclude_planned: z.boolean().optional().describe("true: drop pre-planned Rule 10b5-1 trades."),
      order: z.enum(["asc", "desc"]).optional().describe("desc (default, newest first) or asc."),
      limit: z.number().int().min(1).max(1000).optional().describe("Rows per page, default 100, max 1000."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ insider, start, end, ticker, open_market_only, exclude_planned, order, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/insiders/trades", {
        insider: insider.trim().toLowerCase(),
        start,
        end,
        ticker: ticker?.trim().toUpperCase(),
        open_market_only: open_market_only?.toString(),
        exclude_planned: exclude_planned?.toString(),
        order,
        limit: limit?.toString(),
        offset: offset?.toString(),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
