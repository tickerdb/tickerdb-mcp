import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetUniverse(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_universe",
    "Get selected fields for EVERY asset on one date in a single call (about 11,000 rows), ordered by ticker: the input of a daily or weekly trading model run. Fields use the same names as get_search and are tier-gated the same way; at most 60 per call. Costs 5 credits per 10 fields. member_of / held_by restrict it to an index's or a fund's holdings on that date (\"S&P 500 members with garp_score\"). A row dated D reflects everything known by 04:00 UTC on D+1, so a backtest acts at the next session's open. For filtered or ranked subsets use get_search; for one ticker use get_summary.",
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
        .describe("daily, or weekly (Sunday-dated). Daily snapshots are Pro and Commercial only (Free and Plus read weekly; daily returns 403). Default: daily on Pro and Commercial, weekly on Free and Plus"),
      asset_class: z
        .enum(["stock", "etf", "crypto"])
        .optional()
        .describe("Only this asset class. Omit for all."),
      member_of: z
        .string()
        .optional()
        .describe("Only members of this index on each row's date, e.g. \"sp500\", \"nasdaq100\", \"russell2000\" (list: get_indexes). Point in time: the tracking fund's N-PORT portfolio public on that date (typically 2-5 months old)."),
      held_by: z
        .string()
        .optional()
        .describe("Only assets this fund held on each row's date: fund ticker (e.g. \"IVV\", \"ARKK\") or SEC series id (find with get_funds). Point in time like member_of."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ fields, date, timeframe, asset_class, member_of, held_by }) => {
      const { status, data } = await callTickerDb(apiKey, "/universe", {
        fields: JSON.stringify(fields),
        date,
        timeframe,
        asset_class,
        member_of,
        held_by,
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
