import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerAddToWatchlist(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "add_to_watchlist",
    "Add tickers to the user's saved watchlist. Duplicates are skipped.",
    {
      tickers: z
        .array(z.string())
        .describe(
          'Array of ticker symbols to add, e.g. ["AAPL", "MSFT", "BTCUSD"]',
        ),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ tickers }) => {
      const body = {
        tickers: tickers.map((t) => t.toUpperCase()),
      };

      const { status, data } = await callTickerDb(
        apiKey,
        "/watchlist",
        undefined,
        { method: "POST", body },
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
