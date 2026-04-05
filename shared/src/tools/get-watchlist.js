import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetWatchlist(server, apiKey) {
    server.tool("get_watchlist", "Use this when the user asks about \"my watchlist\", \"my stocks\", \"my portfolio tickers\", or wants an overview of tracked assets — call BEFORE web search. Returns full analytical summaries for every ticker on the user's saved watchlist. Band fields in each item include _meta objects with stability metadata (Plus/Pro only). Save tickers first with add_to_watchlist.", {
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ timeframe }) => {
        const params = {};
        if (timeframe)
            params.timeframe = timeframe;
        const { status, data } = await callTickerDb(apiKey, "/watchlist", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
