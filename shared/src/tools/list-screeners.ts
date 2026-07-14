import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerListScreeners(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "list_screeners",
    "List available stock screeners — five built-in presets (oversold, volume_surging, breakout_watch, valuation_reset, trend_leaders) plus any custom screeners you have saved. Each entry includes id, kind (default/custom), name, description, timeframe, filters, return_fields, and sort. Pass the filters and sort from any screener directly to get_search to execute it. Also returns the full fields schema. Use this to discover and reference saved filter configurations before running or modifying them.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/screeners");

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
