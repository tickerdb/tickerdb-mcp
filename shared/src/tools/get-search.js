import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetSearch(server, apiKey) {
    server.tool("get_search", "Search for assets matching filter criteria. Use this when the user wants to find tickers by categorical state (e.g. 'which stocks are oversold?', 'find tech stocks in strong uptrend'). Pass filters as a JSON-encoded array of {field, op, value} objects. Call get_schema first to discover valid field names - fields use full expanded names (e.g. 'momentum_rsi_zone' not 'rsi_zone', 'volatility_regime' not 'vol_regime'). Use 'fields' to control returned columns and 'sort_by' to rank results server-side.", {
        filters: z
            .string()
            .describe("JSON-encoded filter array. Each filter: {\"field\": \"column_name\", \"op\": \"eq|neq|in|gt|gte|lt|lte\", \"value\": \"...\"}. Example: [{\"field\": \"momentum_rsi_zone\", \"op\": \"in\", \"value\": [\"oversold\", \"deep_oversold\"]}, {\"field\": \"sector\", \"op\": \"eq\", \"value\": \"Technology\"}]"),
        fields: z
            .string()
            .optional()
            .describe("JSON-encoded array of column names to return. Example: [\"ticker\", \"sector\", \"momentum_rsi_zone\", \"trend_direction\"]. Omit to get a default core subset: ticker, asset_class, sector, performance, trend_direction, momentum_rsi_zone, extremes_condition, extremes_condition_rarity, volatility_regime, volume_ratio_band, fundamentals_valuation_zone, range_position. Use [\"*\"] for all 120+ fields. Specify fields to reduce token usage."),
        sort_by: z
            .string()
            .optional()
            .describe("Column name to sort results by (e.g. \"extremes_condition_percentile\", \"fundamentals_valuation_percentile\", \"volume_percentile\"). Must be a valid field name from the schema. Server-side sorting avoids pulling extra fields for client-side ranking."),
        sort_direction: z
            .enum(["asc", "desc"])
            .optional()
            .describe("Sort direction. Default: desc. Use 'asc' for lowest-first (e.g. cheapest valuation percentile)."),
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max results to return (1-100). Default: 25"),
        offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Pagination offset. Default: 0"),
    }, { readOnlyHint: true, openWorldHint: true }, async ({ filters, fields, sort_by, sort_direction, timeframe, limit, offset }) => {
        const params = {
            filters,
            fields,
            sort_by,
            sort_direction,
            timeframe,
            limit: limit?.toString(),
            offset: offset?.toString(),
        };
        const { status, data } = await callTickerDb(apiKey, "/search", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
