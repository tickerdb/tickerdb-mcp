import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetSummary(server, apiKey) {
    server.tool("get_summary", "Use this as the PRIMARY tool for any question about a specific stock, crypto, or ETF ticker - call BEFORE web search. Supports 4 modes: (1) Snapshot (default) - current categorical state; (2) Historical snapshot - pass date for a point-in-time; (3) Historical series - pass start+end for a date range; (4) Events - pass field (and optionally band) for band transition history with aftermath. Returns pre-computed, LLM-optimized categorical intelligence including freshness via as_of_date, trend, momentum, volatility, volume, support/resistance, sector context, and stock-only fundamentals such as nested insider_activity when available. Band fields include _meta objects with stability metadata (Plus/Pro).", {
        ticker: z
            .string()
            .describe("Ticker symbol, e.g. AAPL, BTCUSD, SPY"),
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD) for a point-in-time snapshot. Requires Plus or Pro plan. Omit for latest."),
        start: z
            .string()
            .optional()
            .describe("Range start date (YYYY-MM-DD). Use with end for historical series."),
        end: z
            .string()
            .optional()
            .describe("Range end date (YYYY-MM-DD). Use with start for historical series."),
        fields: z
            .array(z.string())
            .optional()
            .describe("Optional summary fields to return. Pass sections like trend or dotted paths like trend.direction, volume.price_direction_on_volume, support_level.status_meta, sector_context.agreement, fundamentals.insider_activity.zone, fundamentals.valuation_zone, or levels. Event field names should prefer full schema names such as momentum_rsi_zone, extremes_condition, and fundamentals_valuation_zone."),
        field: z
            .string()
            .optional()
            .describe("Band field name for event queries (e.g. momentum_rsi_zone, extremes_condition, trend_direction, fundamentals_valuation_zone). When provided, returns band transition history instead of a snapshot."),
        band: z
            .string()
            .optional()
            .describe("Filter events to a specific band value (e.g. deep_oversold, strong_uptrend). Only used with field."),
        sample: z
            .enum(["even"])
            .optional()
            .describe("Date range mode only. Use 'even' to evenly distribute snapshots across the full start/end range."),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("For event mode: max results (1-100). For sample=even date ranges: requested sampled rows, capped by plan (Free 3, Plus 10, Pro 50)."),
        before: z
            .string()
            .optional()
            .describe("Return events before this date (YYYY-MM-DD). Only used with field."),
        after: z
            .string()
            .optional()
            .describe("Return events after this date (YYYY-MM-DD). Only used with field."),
        context_ticker: z
            .string()
            .optional()
            .describe("Cross-asset correlation: a second ticker to filter against (e.g. SPY). Requires context_field and context_band. Plus/Pro only."),
        context_field: z
            .string()
            .optional()
            .describe("Band field to check on the context ticker (e.g. trend_direction). Must be provided with context_ticker and context_band."),
        context_band: z
            .string()
            .optional()
            .describe("Only return events where the context ticker was in this band (e.g. downtrend). Must be provided with context_ticker and context_field."),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ ticker, timeframe, date, start, end, fields, field, band, sample, limit, before, after, context_ticker, context_field, context_band }) => {
        const params = {
            timeframe,
            date,
            start,
            end,
            fields: fields ? JSON.stringify(fields) : undefined,
            sample,
            field,
            band,
            limit: limit?.toString(),
            before,
            after,
            context_ticker: context_ticker?.toUpperCase(),
            context_field,
            context_band,
        };
        const { status, data } = await callTickerDb(apiKey, `/summary/${encodeURIComponent(ticker.toUpperCase())}`, params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
