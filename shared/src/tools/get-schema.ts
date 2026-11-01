import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetSchema(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_schema",
    "Get the schema of all available fields and their valid band values, with a plain-words description, unit and minimum plan for each. Every field has level: ticker (per-asset snapshot columns for get_search, get_summary) or market (market_* and macro_* regime bands, one row per date, for get_market and as get_search filters matched on the same date). Use this when the user asks 'what fields are available?', 'what bands does momentum_rsi_zone have?', 'what macro bands exist?', or when you need to validate field/band names before calling get_summary with event parameters, get_search with filters, or get_market. Field names follow <group>_<name>[_<unit>]; bands end in a category word (_zone, _trend, _state ...). The response also lists the naming rules and notes that pre-2026-10-31 names are still accepted.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/schema/fields",
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
