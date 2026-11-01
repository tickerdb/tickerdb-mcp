import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetStatus(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_status",
    "When the data last changed (free, 0 credits): for daily and weekly snapshots and each asset class, the newest published date, whether it is preliminary or final (eod), its row count and when it was released; the market level's newest date; recent releases; and the release schedule. Call it to decide whether new data is out before re-pulling summaries, search results or a universe, instead of polling ticker tools.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/status", {});

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
