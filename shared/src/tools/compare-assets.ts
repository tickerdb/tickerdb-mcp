import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerCompareAssets(server: McpServer, apiKey: string) {
  server.tool(
    "compare_assets",
    "Use this when the user asks about multiple tickers, wants a comparison, or asks \"which is better/stronger\" — call BEFORE web search. Returns structured side-by-side analysis with divergence detection across trend, momentum, and valuation. Requires Plus or Pro. Plus: up to 25 tickers. Pro: up to 50.",
    {
      tickers: z
        .string()
        .describe(
          "Comma-separated ticker symbols, e.g. AAPL,MSFT,GOOGL (2-50 tickers)",
        ),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Default: daily"),
      date: z
        .string()
        .optional()
        .describe(
          "Historical date (YYYY-MM-DD). Requires Plus or Pro plan. Omit for latest.",
        ),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ tickers, timeframe, date }) => {
      const params: Record<string, string | undefined> = {
        tickers,
        timeframe,
        date,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        "/compare",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
