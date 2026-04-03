import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetWatchlistChanges(server: McpServer, apiKey: string) {
  server.tool(
    "get_watchlist_changes",
    "Use this when the user asks \"what changed\", \"any updates\", \"what moved\", or wants a diff of tracked tickers — call BEFORE web search. Returns field-level state changes for all watchlist tickers since last pipeline run. Day-over-day or week-over-week diffs. Available on all tiers.",
    {
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Change comparison period. daily = day-over-day, weekly = week-over-week. Default: daily"),
    },
    { readOnlyHint: true, openWorldHint: true },
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
