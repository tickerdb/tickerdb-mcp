import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerRemoveFromWatchlist(server, apiKey) {
    server.tool("remove_from_watchlist", "Remove tickers from your saved watchlist.", {
        tickers: z
            .array(z.string())
            .describe('Array of ticker symbols to remove, e.g. ["MSFT"]'),
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, async ({ tickers }) => {
        const body = {
            tickers: tickers.map((t) => t.toUpperCase()),
        };
        const { status, data } = await callTickerDb(apiKey, "/watchlist", undefined, { method: "DELETE", body });
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
