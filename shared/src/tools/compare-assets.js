import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerCompareAssets(server, apiKey) {
    server.tool("compare_assets", "Compare multiple assets side-by-side. Returns individual summaries plus a comparison highlighting divergences in trend, momentum, and valuation. Requires Plus or Pro plan. Plus: up to 25 tickers. Pro: up to 50.", {
        tickers: z
            .string()
            .describe("Comma-separated ticker symbols, e.g. AAPL,MSFT,GOOGL (2-50 tickers)"),
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro plan. Omit for latest."),
    }, async ({ tickers, timeframe, date }) => {
        const params = {
            tickers,
            timeframe,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, "/compare", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
