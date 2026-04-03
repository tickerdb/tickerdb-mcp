import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerAddToWatchlist(server, apiKey) {
    server.tool("add_to_watchlist", "Add tickers to the user's saved watchlist. Duplicates are skipped. Use list_assets to verify ticker support.", {
        tickers: z
            .array(z.string())
            .describe('Array of ticker symbols to add, e.g. ["AAPL", "MSFT", "BTCUSD"]'),
    }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, async ({ tickers }) => {
        const body = {
            tickers: tickers.map((t) => t.toUpperCase()),
        };
        const { status, data } = await callTickerApi(apiKey, "/watchlist", undefined, { method: "POST", body });
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
