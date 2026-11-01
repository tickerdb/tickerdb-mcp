import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetUniverse(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_universe",
    "Get selected fields for EVERY asset on one date in a single call (about 11,000 rows), ordered by ticker: the input of a daily or weekly trading model run. Fields use the same names as get_search and are tier-gated the same way; at most 60 per call. Costs 5 credits. A row dated D reflects everything known by 04:00 UTC on D+1, so a backtest acts at the next session's open. For filtered or ranked subsets use get_search; for one ticker use get_summary.",
    {
      fields: z
        .array(z.string())
        .min(1)
        .max(60)
        .describe("Fields to return, e.g. [\"trend_direction\", \"momentum_rsi_zone\", \"market_cap_usd\"]. Same names and aliases as get_search; at most 60."),
      date: z
        .string()
        .optional()
        .describe("Date (YYYY-MM-DD). Omit for each asset class's newest published date. History depth depends on plan."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("daily, or weekly (Sunday-dated). Default: daily"),
      asset_class: z
        .enum(["stock", "etf", "crypto"])
        .optional()
        .describe("Only this asset class. Omit for all."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ fields, date, timeframe, asset_class }) => {
      const { status, data } = await callTickerDb(apiKey, "/universe", {
        fields: JSON.stringify(fields),
        date,
        timeframe,
        asset_class,
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
