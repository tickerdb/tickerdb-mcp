import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetMarket(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_market",
    "Get the market level: regime bands for the whole US equity market (market_*) and the US economy (macro_*), one row per date, point in time. Use it for 'what regime is the market in?', 'is breadth washed out?', 'is the yield curve inverted?', 'is the economy in stagflation?', 'what is the recession risk?', 'when did the yield curve last un-invert?', 'list every market regime change in 2024'. Key bands: market_regime_zone (bull_broad, bull_narrow, correction, bear, recovery), market_breadth_ma200_zone (washed_out .. overextended), market_fear_greed_zone, market_valuation_zone, market_volatility_zone, market_risk_appetite_zone, market_earnings_season_zone, macro_regime_zone (goldilocks, reflation, stagflation, deflationary_slowdown), macro_recession_risk_zone, macro_yield_curve_zone (deeply_inverted, inverted, flat, normal, steep), macro_fed_policy_zone, macro_inflation_zone, macro_inflation_trend, macro_labor_market_zone, macro_sahm_rule_zone, macro_gdp_zone. Headline numbers: market_fear_greed_score, market_stocks_below_ma200_pct, market_aggregate_pe_ratio, macro_treasury_yield_2y_pct, macro_treasury_yield_10y_pct, macro_yield_curve_10y_minus_2y_pct, macro_fed_funds_rate_pct, macro_cpi_inflation_yoy_pct, macro_unemployment_rate_pct, macro_gdp_growth_annualized_pct. Every band carries change markers (_prev = label left on the row it changed, _periods = rows in the current label, 1 = changed today, _flips_recent_count, _stability); set changes=true to get only dates where a band changed, with from/to. macro_ values are as first published (never revised later) and low-frequency releases carry until the next one (null once stale). To find tickers under a market condition, put market_/macro_ filters into get_search instead (they match each ticker row's own date). get_schema lists every market field with level=market.",
    {
      fields: z
        .string()
        .optional()
        .describe(
          'JSON-encoded array of market fields to return, e.g. ["market_regime_zone","macro_regime_zone","macro_yield_curve_zone","macro_yield_curve_10y_minus_2y_pct"]. Omit for every band and raw value; ["*"] adds the change markers.',
        ),
      filters: z
        .string()
        .optional()
        .describe(
          'JSON-encoded filter array on market fields, markers included. Example (yield curve just un-inverted): [{"field":"macro_yield_curve_zone_prev","op":"in","value":["inverted","deeply_inverted"]},{"field":"macro_yield_curve_zone","op":"in","value":["flat","normal","steep"]}]. Ops: eq, neq, in, gt, gte, lt, lte.',
        ),
      changes: z
        .string()
        .optional()
        .describe(
          'true = only dates where at least one selected band changed (each row gets changes: [{field, from, to}]); or a JSON array of bands to watch, e.g. ["market_regime_zone","macro_regime_zone"]. Plus and Pro.',
        ),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("daily (every US equity session) or weekly (Sunday-dated). Daily snapshots are Pro and Commercial only (Free and Plus read weekly; daily returns 403). Default: daily on Pro and Commercial, weekly on Free and Plus"),
      date: z
        .string()
        .optional()
        .describe("One date (YYYY-MM-DD). Omit date, start and end for the newest row."),
      start: z
        .string()
        .optional()
        .describe("Range start (YYYY-MM-DD), with end."),
      end: z
        .string()
        .optional()
        .describe("Range end (YYYY-MM-DD), with start."),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Range order by date. Default: desc (newest first)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe("Range rows to return. Default 100, max 2000."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ fields, filters, changes, timeframe, date, start, end, order, limit }) => {
      const params: Record<string, string | undefined> = {
        fields,
        filters,
        changes,
        timeframe,
        date,
        start,
        end,
        order,
        limit: limit?.toString(),
      };
      const { status, data } = await callTickerDb(apiKey, "/market", params);

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
