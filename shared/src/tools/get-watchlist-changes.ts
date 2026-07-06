import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetWatchlistChanges(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_watchlist_changes",
    "Get field-level state changes for all tickers on the user's saved watchlist since the last pipeline run. Supports daily day-over-day and weekly week-over-week comparisons. Each change object includes stability metadata such as stability, periods_in_current_state, flips_recent, and flips_lookback when available. Stability metadata requires a Plus or Pro plan.",
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
