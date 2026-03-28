import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetWatchlistChanges(server: McpServer, apiKey: string) {
  server.tool(
    "get_watchlist_changes",
    "Get field-level state changes for your saved watchlist tickers since the last pipeline run. Shows what changed day-over-day (daily) or week-over-week (weekly). Returns structured diffs with field name, previous value, and current value for each changed ticker. Available on all tiers.",
    {
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Change comparison period. daily = day-over-day, weekly = week-over-week. Default: daily"),
    },
    async ({ timeframe }) => {
      const params: Record<string, string | undefined> = {};
      if (timeframe) params.timeframe = timeframe;

      const { status, data } = await callTickerApi(
        apiKey,
        "/watchlist/changes",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
