import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetHistory(server: McpServer, apiKey: string) {
  server.tool(
    "get_history",
    "Use this when the user needs a historical series for one ticker across a date range instead of one point-in-time snapshot. Returns summary rows plus levels when the plan allows it.",
    {
      ticker: z
        .string()
        .describe("Ticker symbol, e.g. AAPL, BTCUSD, SPY"),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Default: daily"),
      start: z
        .string()
        .describe("Range start date (YYYY-MM-DD)"),
      end: z
        .string()
        .describe("Range end date (YYYY-MM-DD)"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ ticker, timeframe, start, end }) => {
      const params: Record<string, string | undefined> = {
        timeframe,
        start,
        end,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        `/history/${encodeURIComponent(ticker.toUpperCase())}`,
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
