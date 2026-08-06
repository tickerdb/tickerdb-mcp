import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetOhlcv(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_ohlcv",
    "Get stored end-of-day OHLCV candles for a stock, ETF, or crypto ticker, daily or weekly. Use this for exact-return calculations, charts, and backtests after get_summary identifies a setup. Results are paginated; pass next_cursor back as cursor to continue. Equity and ETF bars are split-and-dividend adjusted; crypto bars are unadjusted. Credit cost is 1 credit per 100 bars returned, rounded up, with a 1 credit minimum.",
    {
      ticker: z.string().describe("Ticker symbol, e.g. AAPL, BTCUSD, SPY"),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe(
          "Candle timeframe. Default: daily. Weekly candles cover Monday-Sunday and are dated by the Sunday week end, matching get_summary with timeframe=weekly. The in-progress week is not returned.",
        ),
      start: z.string().optional().describe("Inclusive start date (YYYY-MM-DD). Compared against the candle date, so for weekly this is the Sunday week end. Lookback is limited by plan."),
      end: z.string().optional().describe("Inclusive end date (YYYY-MM-DD). Compared against the candle date."),
      limit: z.number().int().min(1).max(1000).optional().describe("Maximum candles to return (1-1000). Default: 100."),
      order: z.enum(["asc", "desc"]).optional().describe("Sort by candle date. Default: desc."),
      cursor: z.string().optional().describe("Exclusive date cursor from next_cursor for pagination (YYYY-MM-DD)."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ ticker, timeframe, start, end, limit, order, cursor }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        `/ohlcv/${encodeURIComponent(ticker.toUpperCase())}`,
        {
          timeframe,
          start,
          end,
          limit: limit?.toString(),
          order,
          cursor,
        },
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
