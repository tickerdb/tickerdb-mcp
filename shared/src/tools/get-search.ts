import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetSearch(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_search",
    "Search for assets matching filter criteria, including categorical states (e.g. oversold assets, strong uptrends, bull/bear flag setups, triangle or wedge setups, free-cash-flow surplus or burn, recent golden crosses, weekly stage 2 assets near the 40w MA with high volume, volatility squeeze active, volume climax detected, insider buying zone, sector-aligned breakouts, extreme fear, cheap PEG) or rankings by a field such as market_cap_usd on a historical date. Pass filters as a JSON-encoded array of {field, op, value} objects. Use get_schema to discover valid field names (prefer it over guessing). Bands end in a category word (_zone, _state, _direction, _trend, _tier), raw numbers in their unit (_pct, _ratio, _price, _usd, _count, _periods, _score). Examples: momentum_rsi_zone, momentum_rsi (0-100), trend_direction, trend_stage, trend_ma50_slope_zone, trend_distance_ma40_zone (raw trend_distance_ma40_pct), trend_ma_compression_zone, trend_ma_crossover_event, pattern_bull_flag_state, pattern_bull_flag_breakout, pattern_ascending_triangle_state, volume_ratio_zone, volatility_squeeze_active, range_position_zone, fundamentals_free_cash_flow_zone, fundamentals_revenue_zone, fundamentals_peg_ratio / fundamentals_peg_zone, fundamentals_earnings_proximity_zone, forward_outlook_earnings_zone, insider_zone, sector_stocks_oversold_count, fear_greed_score / fear_greed_zone (per asset), and the GARP family garp_score, garp_score_tier, garp_core_score, potential_upside_pct (available once company-guidance coverage is complete; null until then). Names from before the 2026-10-31 renames (volume_ratio_band, trend_distance_ma50, pattern_bull_flag, fundamentals_revenue, range_position, sector_total_count) are still accepted; responses use the new names. MARKET CONDITIONS: market-wide market_* and economy-wide macro_* bands (e.g. market_regime_zone, market_breadth_ma200_zone, market_fear_greed_zone, macro_regime_zone, macro_yield_curve_zone, macro_yield_curve_zone_prev, macro_recession_risk_zone) can be mixed into filters: a market filter keeps only the dates where the condition held, matched on each ticker row's own date; putting a market field in fields attaches that date's value to every row. With start and end plus at least one market filter, every matching date in the range is screened (rows carry date), e.g. stocks oversold on the days breadth was washed out. Use get_market for the market rows themselves. Use fields to control returned columns and sort_by to rank results server-side.",
    {
      filters: z
        .string()
        .describe(
          'JSON-encoded filter array. Each filter: {"field": "column_name", "op": "eq|neq|in|gt|gte|lt|lte", "value": "..."}. Example: [{"field": "momentum_rsi_zone", "op": "in", "value": ["oversold", "deep_oversold"]}, {"field": "sector", "op": "eq", "value": "Technology"}]. Market conditions mix in: [{"field": "market_breadth_ma200_zone", "op": "eq", "value": "washed_out"}] or the yield curve just un-inverting: [{"field": "macro_yield_curve_zone_prev", "op": "eq", "value": "inverted"}]. Change markers work as filters too: <band>_periods = 1 means the band changed on that row, <band>_prev is the label it left.',
        ),
      fields: z
        .string()
        .optional()
        .describe(
          'JSON-encoded array of column names to return. Example: ["ticker", "sector", "market_cap_usd", "fundamentals_pe_ratio", "trend_stage", "trend_ma40_price", "trend_ma50_slope_zone", "trend_ma_crossover_event", "trend_distance_ma40_zone", "pattern_bull_flag_state", "pattern_bull_flag_breakout", "fundamentals_free_cash_flow_zone", "volume_ratio_zone", "fear_greed_zone", "insider_zone", "sector_agreement", "fundamentals_earnings_proximity_zone", "market_regime_zone", "macro_regime_zone"]. market_* / macro_* fields attach the market value of each row\'s date. Omit to get a default core subset: ticker, asset_class, sector, market_cap_usd, market_cap_tier, momentum_performance_zone, trend_direction, trend_ma20_slope_zone, trend_ma_compression_zone, trend_ma_crossover_event, momentum_rsi_zone, extremes_condition, extremes_condition_rarity, volatility_regime, volume_ratio_zone, pattern_*_state for the seven patterns plus pattern_bull_flag_breakout / pattern_bear_flag_breakdown, fundamentals_valuation_zone, range_position_zone. Use ["*"] for all ticker fields. Specify fields to reduce token usage. trend_stage is weekly-only and should be requested with timeframe=weekly. Fundamentals, forward_outlook, insider, sector context, GARP and potential fields are Pro; support/resistance/range/breakout fields need Plus; change markers (_periods, _prev, _stability, _flips_recent_count) need Plus.',
        ),
      sort_by: z
        .string()
        .optional()
        .describe(
          'Ticker field to sort results by (e.g. "market_cap_usd", "fundamentals_pe_ratio", "fundamentals_peg_ratio", "fear_greed_score", "garp_score", "extremes_condition_rarity_percentile", "fundamentals_valuation_percentile", "volume_percentile", "sector_stocks_oversold_count"). Market-level fields cannot be sorted on (one value per date). Server-side sorting avoids pulling extra fields for client-side ranking.',
        ),
      sort_direction: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. Default: desc. Use 'asc' for lowest-first (e.g. cheapest valuation percentile)."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Daily snapshots are Pro and Commercial only (Free and Plus read weekly; daily returns 403). Default: daily on Pro and Commercial, weekly on Free and Plus"),
      date: z
        .string()
        .optional()
        .describe("Historical snapshot date (YYYY-MM-DD). Omit for latest per asset class. Do not combine with start/end."),
      start: z
        .string()
        .optional()
        .describe("Date-range screen start (YYYY-MM-DD), with end. Requires at least one market_* or macro_* filter, which selects the dates; rows then carry date, newest first."),
      end: z
        .string()
        .optional()
        .describe("Date-range screen end (YYYY-MM-DD), with start."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max results to return. Tier-gated: Starter 25, Plus 100, Pro 500. Default: 20"),
      member_of: z
        .string()
        .optional()
        .describe("Only members of this index on each row's date, e.g. \"sp500\", \"nasdaq100\", \"russell2000\" (list: get_indexes). Point in time: the tracking fund's N-PORT portfolio public on that date (typically 2-5 months old)."),
      held_by: z
        .string()
        .optional()
        .describe("Only assets this fund held on each row's date: fund ticker (e.g. \"IVV\", \"ARKK\") or SEC series id (find with get_funds). Point in time like member_of."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ filters, fields, sort_by, sort_direction, timeframe, date, start, end, limit, member_of, held_by }) => {
      const params: Record<string, string | undefined> = {
        filters,
        fields,
        sort_by,
        sort_direction,
        timeframe,
        date,
        start,
        end,
        limit: limit?.toString(),
        member_of,
        held_by,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        "/search",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
