import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetWatchlist(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_watchlist",
    "Get analytical summaries for every ticker on the user's saved watchlist. This supports requests about the user's watchlist, tracked stocks, portfolio tickers, or an overview of tracked assets. Band fields in each item include _meta objects with stability metadata on Plus and Pro plans. Use add_to_watchlist to save tickers first.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/watchlist");

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
