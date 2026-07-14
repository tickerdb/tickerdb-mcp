import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetSearch(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_search",
    "Search for assets matching filter criteria, including categorical states (e.g. oversold assets, strong uptrends, bull/bear flag setups, triangle or wedge setups, free-cash-flow surplus or burn, recent golden crosses, weekly stage 2 assets near the 40w MA with high volume, volatility squeeze active, volume climax detected, insider buying zone, sector-aligned breakouts) or rankings by a field such as market_cap on a historical date. Pass filters as a JSON-encoded array of {field, op, value} objects. Use get_schema to discover valid field names; fields use clean flat names for raw values such as ma8 and ma200, and full expanded names for semantic fields such as momentum_rsi_zone, pattern_bull_flag, pattern_ascending_triangle, pattern_rising_wedge, trend_ma_crossover_event, trend_distance_ma40, trend_stage, fundamentals_free_cash_flow, insider_zone, sector_agreement, volatility_squeeze_active, volume_climax_detected, fundamentals_analyst_consensus, and fundamentals_earnings_proximity. Use fields to control returned columns and sort_by to rank results server-side. To run a saved screener, call list_screeners to get its filters and sort, then pass them here.",
    {
      filters: z
        .string()
        .describe(
          'JSON-encoded filter array. Each filter: {"field": "column_name", "op": "eq|neq|in|gt|gte|lt|lte", "value": "..."}. Example: [{"field": "momentum_rsi_zone", "op": "in", "value": ["oversold", "deep_oversold"]}, {"field": "sector", "op": "eq", "value": "Technology"}]',
        ),
      fields: z
        .string()
        .optional()
        .describe(
          'JSON-encoded array of column names to return. Example: ["ticker", "sector", "market_cap", "trend_stage", "ma40", "trend_ma50_slope", "trend_ma_crossover_event", "trend_distance_ma40", "pattern_bull_flag", "pattern_ascending_triangle", "fundamentals_free_cash_flow", "volume_ratio_band", "insider_zone", "sector_agreement", "volatility_squeeze_active", "volume_climax_detected", "fundamentals_analyst_consensus", "fundamentals_earnings_proximity"]. Omit to get a default core subset: ticker, asset_class, sector, market_cap, market_cap_tier, performance, trend_direction, trend_ma20_slope, trend_ma_compression_band, trend_ma_crossover_event, momentum_rsi_zone, extremes_condition, extremes_condition_rarity, volatility_regime, volume_ratio_band, pattern_bull_flag, pattern_bear_flag, pattern_ascending_triangle, pattern_descending_triangle, pattern_symmetrical_triangle, pattern_rising_wedge, pattern_falling_wedge, fundamentals_valuation_zone, range_position. Request fundamentals_free_cash_flow explicitly when you need the stock-only free cash flow burn/surplus band. Request ma8 through ma200 for raw MA values and trend_ma8_slope through trend_ma200_slope for the full MA slope set. Use ["*"] for all fields. Specify fields to reduce token usage. trend_stage is weekly-only and should be requested with timeframe=weekly. Insider fields (insider_zone, insider_net_direction) and sector context fields (sector_rsi_zone, sector_trend, sector_agreement) are available on paid tiers.',
        ),
      sort_by: z
        .string()
        .optional()
        .describe(
          'Column name to sort results by (e.g. "market_cap", "extremes_condition_percentile", "fundamentals_valuation_percentile", "volume_percentile", "sector_oversold_count", "sector_breakout_count"). Must be a valid field name from the schema. Server-side sorting avoids pulling extra fields for client-side ranking.',
        ),
      sort_direction: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Sort direction. Default: desc. Use 'asc' for lowest-first (e.g. cheapest valuation percentile)."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Default: daily"),
      date: z
        .string()
        .optional()
        .describe("Historical snapshot date (YYYY-MM-DD). Omit for latest per asset class."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max results to return. Tier-gated: Starter 25, Plus 100, Pro 500. Default: 20"),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ filters, fields, sort_by, sort_direction, timeframe, date, limit }) => {
      const params: Record<string, string | undefined> = {
        filters,
        fields,
        sort_by,
        sort_direction,
        timeframe,
        date,
        limit: limit?.toString(),
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
  tool.update({ outputSchema: tickerDbOutputSchema });
}
