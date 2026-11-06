import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetSchema(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_schema",
    "Look up TickerDB fields: name, plain-words description, unit and valid band values. SEARCH, don't pull the whole list: the full schema is about 230 KB (every field plus five change markers per band), while search=\"bull flag\" or search=\"volume percentile\" returns a few hundred bytes. Use search (every word must appear in the name, category or description), category (e.g. patterns, volume, trend, momentum, fundamentals, macro) and level (ticker = per-asset columns for get_search/get_summary/get_universe; market = market_* and macro_* rows for get_market, also usable as get_search filters on the same date); compact=true trims each field to name, type, values and description. Narrowed results omit the change markers: a band with tracked: true also has <band>_stability, _periods, _flips_recent_count, _flips_lookback and _prev (markers=true lists them). Field names follow <group>_<name>[_<unit>]; bands end in a category word (_zone, _trend, _state ...); raw numbers end in their unit (_pct, _ratio, _price ...). Call with no parameters only when you really need every field.",
    {
      search: z
        .string()
        .optional()
        .describe('Words that must all appear in the field name, category or description, e.g. "bull flag", "volume percentile", "ma200 distance", "yield curve". "_" counts as a space; name matches come first.'),
      category: z
        .string()
        .optional()
        .describe("Comma-separated categories, e.g. patterns,volume. The response lists every category."),
      level: z
        .enum(["ticker", "market"])
        .optional()
        .describe("ticker = per-asset snapshot columns; market = market_* and macro_* fields."),
      compact: z
        .boolean()
        .optional()
        .describe("true = name, type, category, level, values and description only (drops markers unless markers=true)."),
      markers: z
        .boolean()
        .optional()
        .describe("Include the per-band change-marker fields. Default: true for the plain list, false once search, category or compact is given."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ search, category, level, compact, markers }) => {
      const { status, data } = await callTickerDb(apiKey, "/schema/fields", {
        search,
        category,
        level,
        compact: compact === undefined ? undefined : String(compact),
        markers: markers === undefined ? undefined : String(markers),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
