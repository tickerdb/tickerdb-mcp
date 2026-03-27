import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerAddToWatchlist(server: McpServer, apiKey: string) {
  server.tool(
    "add_to_watchlist",
    "Add tickers to your saved watchlist. Only supported tickers can be added (use list_assets to check). Duplicates are skipped. The saved watchlist is what webhooks monitor.",
    {
      tickers: z
        .array(z.string())
        .describe(
          'Array of ticker symbols to add, e.g. ["AAPL", "MSFT", "BTCUSD"]',
        ),
    },
    async ({ tickers }) => {
      const body = {
        tickers: tickers.map((t) => t.toUpperCase()),
      };

      const { status, data } = await callTickerApi(
        apiKey,
        "/watchlist",
        undefined,
        { method: "POST", body },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
