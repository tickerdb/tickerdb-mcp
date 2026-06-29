import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetSummary(server: McpServer, apiKey: string) {
  server.tool(
    "get_summary",
    "Use this as the PRIMARY tool for any question about a specific stock, crypto, or ETF ticker - call BEFORE web search. Supports 4 modes: (1) Snapshot (default) - current categorical state; (2) Historical snapshot - pass date for a point-in-time; (3) Historical series - pass start+end for a date range; (4) Events - pass field (and optionally band) for band transition history with aftermath, including exact close-to-close return_*_pct fields on paid tiers, weekly-only stage analysis via trend_stage, MA signal fields such as trend_ma_crossover_event, and MA distance lookbacks such as trend_distance_ma40. Add stats=true in event mode to get aggregate event-band and aftermath distributions instead of raw rows. Returns pre-computed, LLM-optimized categorical intelligence including freshness via as_of_date, exact same-candle ohlcv, market_cap, market_cap_tier, trend, momentum, volatility, volume, support/resistance, sector context, and stock-only fundamentals such as nested insider_activity when available. Summary keeps sibling _meta objects off by default; set meta=true or request explicit *_meta fields when you need paid-tier stability metadata.",
    {
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
        .describe(
          "Historical date (YYYY-MM-DD) for a point-in-time snapshot. Requires Plus or Pro plan. Omit for latest.",
        ),
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
        .describe(
          "Optional summary fields to return. Identity fields such as market_cap and market_cap_tier are always kept. Pass sections like ohlcv, trend or dotted paths like ohlcv.close, trend.direction, trend.stage, trend.ma_slope_band, trend.ma_crossover_event, trend.direction_meta, trend.distance_from_ma_band.ma_40, volume.price_direction_on_volume, support_level.level_price, support_level.status_meta, sector_context.agreement, fundamentals.insider_activity.zone, fundamentals.valuation_zone, or levels. trend.stage is populated on weekly snapshots when stage evidence is sufficient. Event field names should prefer full schema names such as momentum_rsi_zone, extremes_condition, trend_stage, trend_ma_crossover_event, trend_distance_ma40, and fundamentals_valuation_zone.",
        ),
      meta: z
        .boolean()
        .optional()
        .describe(
          "Snapshot and history modes only. Add true to include sibling _meta / status_meta stability objects across the response. Explicit *_meta field paths in fields still work without this flag.",
        ),
      field: z
        .string()
        .optional()
        .describe(
          "Band field name for event queries (e.g. momentum_rsi_zone, extremes_condition, trend_direction, trend_stage, trend_ma_crossover_event, trend_distance_ma40, fundamentals_valuation_zone). When provided, returns band transition history instead of a snapshot.",
        ),
      band: z
        .string()
        .optional()
        .describe(
          "Filter events to a specific band value (e.g. deep_oversold, strong_uptrend, stage_2_growth). For MA distance event fields such as trend_distance_ma40, grouped aliases above and below are also supported. Only used with field.",
        ),
      sample: z
        .enum(["even"])
        .optional()
        .describe(
          "Date range mode only. Use 'even' to evenly distribute snapshots across the full start/end range.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("For event mode: max results (1-50), returned newest-first by default. For sample=even date ranges: requested sampled rows, capped by plan (Free 3, Plus 10, Pro 50)."),
      before: z
        .string()
        .optional()
        .describe("Return events before this date (YYYY-MM-DD). Only used with field."),
      after: z
        .string()
        .optional()
        .describe("Return events after this date (YYYY-MM-DD). Only used with field."),
      stats: z
        .boolean()
        .optional()
        .describe("Event mode only. Add true to return aggregate stats instead of raw event rows."),
      context_ticker: z
        .string()
        .optional()
        .describe(
          "Cross-asset correlation: a second ticker to filter against (e.g. SPY). Requires context_field and context_band. Plus/Pro only.",
        ),
      context_field: z
        .string()
        .optional()
        .describe(
          "Band field to check on the context ticker (e.g. trend_direction, trend_stage, or trend_distance_ma40). Must be provided with context_ticker and context_band.",
        ),
      context_band: z
        .string()
        .optional()
        .describe(
          "Only return events where the context ticker was in this band (e.g. downtrend). For MA distance context fields, grouped aliases above and below are also supported. Must be provided with context_ticker and context_field.",
        ),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ ticker, timeframe, date, start, end, fields, meta, field, band, sample, limit, before, after, stats, context_ticker, context_field, context_band }) => {
      const params: Record<string, string | undefined> = {
        timeframe,
        date,
        start,
        end,
        fields: fields ? JSON.stringify(fields) : undefined,
        meta: meta === undefined ? undefined : meta ? "true" : "false",
        sample,
        field,
        band,
        limit: limit?.toString(),
        before,
        after,
        stats: stats === undefined ? undefined : stats ? "true" : "false",
        context_ticker: context_ticker?.toUpperCase(),
        context_field,
        context_band,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        `/summary/${encodeURIComponent(ticker.toUpperCase())}`,
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
