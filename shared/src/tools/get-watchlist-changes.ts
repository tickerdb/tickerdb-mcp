import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetWatchlistChanges(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_watchlist_changes",
    "Get field-level state changes for all tickers on the user's saved watchlist since the last pipeline run. Supports daily day-over-day and weekly week-over-week comparisons. Each change object includes stability metadata such as stability, periods_in_current_state, flips_recent, and flips_lookback when available. Stability metadata requires a Plus or Pro plan. Prefer this over get_watchlist for monitoring questions such as whether anything moved, turned bearish, or became overbought, and for tracking a watchlist over time: it returns only what changed, while get_watchlist returns full summaries for every tracked ticker and is far larger on a big watchlist. Use get_watchlist when the current state of the whole list is needed rather than just the deltas. This is the only way to get week-over-week changes; the notable_changes array on get_watchlist is day-over-day only.",
    {
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Change comparison period. daily = day-over-day, weekly = week-over-week. Default: daily"),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ timeframe }) => {
      const params: Record<string, string | undefined> = {};
      if (timeframe) params.timeframe = timeframe;

      const { status, data } = await callTickerDb(
        apiKey,
        "/watchlist/changes",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
