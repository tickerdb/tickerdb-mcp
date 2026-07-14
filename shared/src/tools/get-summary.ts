import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetSummary(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_summary",
    "Get pre-computed market intelligence for a specific stock, crypto, or ETF ticker. Supports 4 modes: (1) Snapshot (default) for the latest categorical state; (2) Historical snapshot by date; (3) Historical series with start and end dates; (4) Events by field and optional band, including aftermath fields on paid tiers, weekly trend_stage analysis, pattern setup states such as pattern_bull_flag and pattern_ascending_triangle, MA signal fields, trend_ma_crossover_event, MA distance lookbacks such as trend_distance_ma40, and stock-only fundamentals_free_cash_flow events. Add stats=true in event mode to return aggregate event-band and aftermath distributions instead of raw rows. Results can include freshness via as_of_date, same-candle OHLCV, market_cap, market_cap_tier, trend, momentum (including divergence_detected, divergence_type, stochastic_zone), volatility (including squeeze_active, squeeze_days), volume (including climax_detected, climax_type), patterns, support/resistance, levels (paid tiers), sector_context (rsi_zone, trend, agreement, asset_vs_sector_rsi), and stock-only fundamentals such as free_cash_flow, growth_zone, earnings_proximity, analyst_consensus, valuation_percentile, and nested insider_activity when available. Summary keeps sibling _meta objects off by default; set meta=true or request explicit *_meta fields when paid-tier stability metadata is needed.",
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
          "Optional summary fields to return. Identity fields such as market_cap and market_cap_tier are always kept. Pass sections like ohlcv, trend, momentum, volatility, volume, patterns, extremes, support_level, resistance_level, fundamentals, sector_context, or levels (paid tiers). Or pass dotted paths like ohlcv.close, trend.direction, trend.stage, trend.ma_slopes.ma_8, trend.ma_slopes.ma_20, trend.ma_slopes.ma_40, trend.ma_slopes.ma_50, trend.ma_slopes.ma_100, trend.ma_slopes.ma_200, trend.moving_average_values.ma_8, trend.ma_crossover_event, trend.direction_meta, trend.distance_from_ma_band.ma_40, trend.volume_confirmation, momentum.rsi_zone, momentum.stochastic_zone, momentum.xtrm_score, momentum.divergence_detected, momentum.divergence_type, momentum.macd_state, patterns.bull_flag, patterns.bear_flag, patterns.ascending_triangle, patterns.rising_wedge, volatility.squeeze_active, volatility.squeeze_days, volatility.regime_trend, volume.climax_detected, volume.climax_type, volume.accumulation_state, volume.price_direction_on_volume, support_level.level_price, support_level.status_meta, resistance_level.level_price, sector_context.rsi_zone, sector_context.trend, sector_context.agreement, sector_context.asset_vs_sector_rsi, sector_context.asset_vs_sector_trend, sector_context.oversold_count, sector_context.valuation_zone, fundamentals.valuation_zone, fundamentals.growth_zone, fundamentals.free_cash_flow, fundamentals.earnings_proximity, fundamentals.last_earnings_surprise, fundamentals.analyst_consensus, fundamentals.analyst_consensus_direction, fundamentals.valuation_percentile, fundamentals.pe_vs_historical_zone, fundamentals.pe_vs_sector_zone, fundamentals.insider_activity, fundamentals.insider_activity.zone, fundamentals.insider_activity.net_direction, levels, levels.support_levels, levels.resistance_levels. trend.stage is populated on weekly snapshots when stage evidence is sufficient. Event field names should prefer full schema names such as momentum_rsi_zone, extremes_condition, trend_stage, pattern_bull_flag, pattern_ascending_triangle, pattern_rising_wedge, trend_ma8_slope through trend_ma200_slope, trend_ma_crossover_event, trend_distance_ma40, fundamentals_valuation_zone, fundamentals_free_cash_flow, insider_zone, sector_rsi_zone, momentum_divergence_detected, and fundamentals_analyst_consensus.",
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
          "Band field name for event queries (e.g. momentum_rsi_zone, extremes_condition, trend_direction, trend_stage, pattern_bull_flag, pattern_ascending_triangle, pattern_rising_wedge, trend_ma8_slope through trend_ma200_slope, trend_ma_crossover_event, trend_distance_ma40, fundamentals_valuation_zone, fundamentals_free_cash_flow, insider_zone, sector_rsi_zone, momentum_divergence_detected, fundamentals_analyst_consensus). When provided, returns band transition history instead of a snapshot.",
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
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
