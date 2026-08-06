import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerRemoveFromWatchlist(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "remove_from_watchlist",
    "Remove tickers from the user's saved watchlist. Only call this when the user explicitly asks to stop tracking, remove, or drop a ticker; never prune the watchlist on your own initiative. Removal only stops tracking and can be undone with add_to_watchlist.",
    {
      tickers: z
        .array(z.string())
        .describe(
          'Array of ticker symbols to remove, e.g. ["MSFT"]',
        ),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ tickers }) => {
      const body = {
        tickers: tickers.map((t) => t.toUpperCase()),
      };

      const { status, data } = await callTickerDb(
        apiKey,
        "/watchlist",
        undefined,
        { method: "DELETE", body },
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
