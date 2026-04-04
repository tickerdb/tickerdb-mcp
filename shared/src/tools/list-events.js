import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListEvents(server, apiKey) {
    server.tool("list_events", "Use this when the user asks \"when was X last oversold\", \"how did X perform after Y\", or wants historical state transitions — call BEFORE web search. Returns when a categorical band changed, how long it lasted, and aftermath performance. Each event includes stability_at_entry (Plus/Pro) and flips_recent_at_entry + flips_lookback (Plus/Pro). Free: technical fields, no aftermath. Plus: adds fundamentals + aftermath. Pro: all fields + aftermath.", {
        ticker: z
            .string()
            .describe("Ticker symbol, e.g. AAPL, TSLA, BTC"),
        field: z
            .string()
            .describe("Band field name to query transitions for. Valid fields — Technical: rsi_zone, trend_direction, ma_alignment, volume_ratio_band, accumulation_state, volatility_regime, macd_state. Support/Resistance: support_status, resistance_status. Fundamentals (Plus): valuation_zone, growth_zone, earnings_proximity, analyst_consensus. Fundamentals (Pro): pe_vs_historical, pe_vs_sector, revenue_growth_direction, eps_growth_direction, earnings_surprise, analyst_consensus_direction, insider_activity_zone, net_direction."),
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
        context_ticker: z
            .string()
            .optional()
            .describe("Cross-asset correlation: a second ticker to filter against. Requires context_field and context_band. Plus/Pro only. Example: set context_ticker=SPY to only return events where SPY was in a specific state."),
        context_field: z
            .string()
            .optional()
            .describe("Band field to check on the context ticker (e.g. trend_direction, rsi_zone). Must be provided with context_ticker and context_band."),
        context_band: z
            .string()
            .optional()
            .describe("Only return events where the context ticker was in this band on the event date (e.g. downtrend, deep_oversold). Must be provided with context_ticker and context_field."),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ ticker, field, timeframe, band, limit, before, after, context_ticker, context_field, context_band }) => {
        const params = {
            ticker: ticker.toUpperCase(),
            field,
            timeframe,
            band,
            limit: limit?.toString(),
            before,
            after,
            context_ticker: context_ticker?.toUpperCase(),
            context_field,
            context_band,
        };
        const { status, data } = await callTickerApi(apiKey, "/events", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
