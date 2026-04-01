import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListEvents(server, apiKey) {
    server.tool("list_events", "Search for historical band transition events for a ticker. Returns when a categorical band value changed (e.g. RSI entering deep_oversold), how long it lasted, and what happened afterward (aftermath performance). Use this to answer questions like 'when was AAPL last deep_oversold?' or 'how did TSLA perform after entering overbought?'. Free tier: technical fields only, no aftermath. Plus: adds basic fundamentals + aftermath. Pro: all fields + aftermath.", {
        ticker: z
            .string()
            .describe("Ticker symbol, e.g. AAPL, TSLA, BTC"),
        field: z
            .string()
            .describe("Band field name to query transitions for. Examples: rsi_zone, trend_direction, valuation_zone, macd_state, volatility_regime, analyst_consensus"),
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        band: z
            .string()
            .optional()
            .describe("Filter to a specific band value, e.g. deep_oversold, strong_uptrend, deep_value"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max results to return (1-100). Default: 10"),
        before: z
            .string()
            .optional()
            .describe("Return events before this date (YYYY-MM-DD)"),
        after: z
            .string()
            .optional()
            .describe("Return events after this date (YYYY-MM-DD)"),
    }, async ({ ticker, field, timeframe, band, limit, before, after }) => {
        const params = {
            ticker: ticker.toUpperCase(),
            field,
            timeframe,
            band,
            limit: limit?.toString(),
            before,
            after,
        };
        const { status, data } = await callTickerApi(apiKey, "/events", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
