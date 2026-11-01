import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetChanges(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_changes",
    "Get field-level band changes of the newest published date for up to 50 tickers: day-over-day for daily, week-over-week for weekly. Each change is {field, from, to}; Plus and Pro also get stability, periods_in_current_state and recent flips. ticker_context gives each ticker's last_changed_date. Use it for 'what changed for AAPL, MSFT and NVDA today?' instead of pulling full summaries; use get_summary for one ticker's full state.",
    {
      tickers: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Ticker symbols, e.g. [\"AAPL\", \"MSFT\"]. At most 50."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("daily (day-over-day) or weekly (week-over-week). Daily snapshots are Pro and Commercial only (Free and Plus read weekly; daily returns 403). Default: daily on Pro and Commercial, weekly on Free and Plus"),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ tickers, timeframe }) => {
      const { status, data } = await callTickerDb(apiKey, "/changes", {
        tickers: tickers.map((t) => t.trim().toUpperCase()).join(","),
        timeframe,
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
