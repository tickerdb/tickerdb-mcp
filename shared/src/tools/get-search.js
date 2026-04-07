import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetSearch(server, apiKey) {
    server.tool("get_search", "Search for assets matching filter criteria. Use this when the user wants to find tickers by categorical state (e.g. 'which stocks are oversold?', 'find tech stocks in strong uptrend'). Pass filters as a JSON object describing the desired band values.", {
        filters: z
            .string()
            .optional()
            .describe("JSON-encoded filter object. Keys are field names, values are band values or arrays of band values. Example: {\"rsi_zone\": \"deep_oversold\", \"trend_direction\": [\"uptrend\", \"strong_uptrend\"]}"),
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
    }, { readOnlyHint: true, openWorldHint: true }, async ({ filters, timeframe, limit, offset }) => {
        const params = {
            filters,
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
