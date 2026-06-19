import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetOhlcv(server: McpServer, apiKey: string) {
  server.tool(
    "get_ohlcv",
    "Get stored daily end-of-day OHLCV candles for a stock, ETF, or crypto ticker. Use this for exact-return calculations, charts, and backtests after get_summary identifies a setup. Results are paginated; pass next_cursor back as cursor to continue. Equity and ETF bars are split-and-dividend adjusted; crypto bars are unadjusted.",
    {
      ticker: z.string().describe("Ticker symbol, e.g. AAPL, BTCUSD, SPY"),
      start: z.string().optional().describe("Inclusive start date (YYYY-MM-DD). Lookback is limited by plan."),
      end: z.string().optional().describe("Inclusive end date (YYYY-MM-DD)."),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum candles to return (1-500). Default: 100."),
      order: z.enum(["asc", "desc"]).optional().describe("Sort by candle date. Default: desc."),
      cursor: z.string().optional().describe("Exclusive date cursor from next_cursor for pagination (YYYY-MM-DD)."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ ticker, start, end, limit, order, cursor }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        `/ohlcv/${encodeURIComponent(ticker.toUpperCase())}`,
        {
          start,
          end,
          limit: limit?.toString(),
          order,
          cursor,
        },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
