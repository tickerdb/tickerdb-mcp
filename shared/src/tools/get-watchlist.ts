import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetWatchlist(server: McpServer, apiKey: string) {
  server.tool(
    "get_watchlist",
    "Get live data for all tickers on your saved watchlist. Returns trend, momentum, volume, extremes, support/resistance, and notable changes for each saved ticker. Save tickers first with add_to_watchlist.",
    {
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Default: daily"),
    },
    async ({ timeframe }) => {
      const params: Record<string, string | undefined> = {};
      if (timeframe) params.timeframe = timeframe;

      const { status, data } = await callTickerApi(
        apiKey,
        "/watchlist",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
