import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetSummary(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_summary",
    "Get pre-computed market intelligence for a specific stock, crypto, or ETF ticker. Supports 4 modes: (1) Snapshot (default) for the latest categorical state; (2) Historical snapshot by date; (3) Historical series with start and end dates; (4) Events by field and optional band (when a band was entered, what it left, how long the prior state lasted), for any tracked band: momentum_rsi_zone, trend_direction, trend_stage, trend_ma8_slope_zone through trend_ma200_slope_zone, trend_distance_ma40_zone, trend_ma_crossover_event, pattern_bull_flag_state, pattern_ascending_triangle_state, volume_ratio_zone, fear_greed_zone, fundamentals_free_cash_flow_zone, fundamentals_peg_zone, forward_outlook_earnings_zone, garp_score_tier and more (old names such as pattern_bull_flag or volume_ratio_band are still accepted). Add stats=true in event mode for aggregate counts by band. Results include as_of_date, same-candle OHLCV, market_cap_usd, market_cap_tier, performance_zone, trend (ma_slopes, distance_from_ma_zone, ma_compression_zone, volume_confirmation_state), momentum (raw rsi, stochastic_k, stochastic_d beside their zones), extremes (condition_rarity_percentile), volatility, volume (ratio_zone, price_on_volume_direction), patterns (*_state), support/resistance (distance_zone, volume_at_tests_zone), range_position_zone, breakout_type, fear_greed (score 0-100 and zone), levels (paid tiers), sector_context (stocks_oversold_count, stocks_count, asset_vs_sector_rsi_zone ...), and stock-only fundamentals (pe_ratio, pb_ratio, peg_ratio, peg_zone, reporting_currency, revenue_zone, profitability_zone, cash_flow_zone, balance_sheet_zone, free_cash_flow_zone, earnings_proximity_zone, analyst_consensus_zone, forward_outlook.*_zone, insider_activity) plus garp (with garp.core) and potential blocks (Pro; available once company-guidance coverage is complete, null until then). Market-wide and macro regimes are not part of a ticker summary: use get_market. Summary keeps sibling _meta objects off by default; set meta=true or request explicit *_meta fields when paid-tier stability metadata is needed.",
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
          "Optional summary fields to return. Identity fields such as market_cap_usd and market_cap_tier are always kept. Pass sections like ohlcv, trend, momentum, volatility, volume, patterns, extremes, support_level, resistance_level, fear_greed, fundamentals, sector_context, garp, potential, or levels (paid tiers). Or pass dotted paths like ohlcv.close, trend.direction, trend.stage, trend.ma_slopes.ma_50, trend.moving_average_values.ma_50_price, trend.ma_crossover_event, trend.direction_meta, trend.distance_from_ma_zone.ma_40, trend.distance_from_ma_pct.ma_40, trend.ma_compression_zone, trend.volume_confirmation_state, momentum.rsi, momentum.rsi_zone, momentum.stochastic_k, momentum.stochastic_zone, momentum.macd_state, patterns.bull_flag_state, patterns.bull_flag_breakout, patterns.ascending_triangle_state, volatility.squeeze_active, volatility.squeeze_periods, volume.ratio_zone, volume.climax_detected, volume.price_on_volume_direction, support_level.level_price, support_level.distance_zone, support_level.status_meta, range_position_zone, breakout_type, fear_greed.score, fear_greed.zone, sector_context.rsi_zone, sector_context.asset_vs_sector_rsi_zone, sector_context.stocks_oversold_count, fundamentals.pe_ratio, fundamentals.peg_ratio, fundamentals.peg_zone, fundamentals.reporting_currency, fundamentals.valuation_zone, fundamentals.free_cash_flow_zone, fundamentals.revenue_zone, fundamentals.earnings_proximity_zone, fundamentals.analyst_consensus_zone, fundamentals.forward_outlook.earnings_zone, fundamentals.insider_activity, garp.score, garp.score_tier, garp.core.score, potential.upside_pct, levels.support_levels. Flat search names (e.g. volume_ratio_zone, fundamentals_peg_ratio, garp_score) and pre-2026-10-31 paths (volume.ratio_band, patterns.bull_flag, fundamentals.revenue) are accepted too; responses use the new keys. trend.stage is populated on weekly snapshots when stage evidence is sufficient.",
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
          "Band field name for event queries (e.g. momentum_rsi_zone, extremes_condition, trend_direction, trend_stage, pattern_bull_flag_state, pattern_ascending_triangle_state, pattern_rising_wedge_state, trend_ma8_slope_zone through trend_ma200_slope_zone, trend_ma_crossover_event, trend_distance_ma40_zone, volume_ratio_zone, fear_greed_zone, fundamentals_valuation_zone, fundamentals_free_cash_flow_zone, fundamentals_peg_zone, fundamentals_analyst_consensus_zone, forward_outlook_earnings_zone, garp_score_tier, insider_zone). Old names are accepted. When provided, returns band transition history instead of a snapshot.",
        ),
      band: z
        .string()
        .optional()
        .describe(
          "Filter events to a specific band value (e.g. deep_oversold, strong_uptrend, stage_2_growth, extreme_fear). For MA distance event fields such as trend_distance_ma40_zone, grouped aliases above and below are also supported. Only used with field.",
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
          "Band field to check on the context ticker (e.g. trend_direction, trend_stage, or trend_distance_ma40_zone). Must be provided with context_ticker and context_band.",
        ),
      context_band: z
        .string()
        .optional()
        .describe(
          "Only return events where the context ticker was in this band (e.g. downtrend). For MA distance context fields, grouped aliases above and below are also supported. Must be provided with context_ticker and context_field.",
        ),
      adjustment: z
        .enum(["split", "split_dividend", "raw"])
        .optional()
        .describe(
          "Price basis. split (default): today's share basis, every split applied. split_dividend: splits plus cash dividends (a total-return series). raw: as traded on each date (prices in the ohlcv block).",
        ),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ ticker, timeframe, date, start, end, fields, meta, field, band, sample, limit, before, after, stats, context_ticker, context_field, context_band, adjustment }) => {
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
        adjustment,
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
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
