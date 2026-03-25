import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetSummary(server, apiKey) {
    server.tool("get_summary", "Get a pre-computed market summary for a single ticker. Returns categorical data: trend direction, RSI zone, volatility regime, volume context, support/resistance levels, and fundamentals (valuation, growth, earnings). Fields vary by plan tier — Free: core technical. Plus: adds levels and fundamentals. Pro: all fields including sector context.", {
        ticker: z
            .string()
            .describe("Ticker symbol, e.g. AAPL, BTC, SPY"),
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro plan. Omit for latest."),
    }, async ({ ticker, timeframe, date }) => {
        const params = {
            timeframe,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, `/summary/${encodeURIComponent(ticker.toUpperCase())}`, params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
