import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerScanValuation(server, apiKey) {
    server.tool("scan_valuation", "Scan for stocks with notable valuation extremes based on PE ratios, growth metrics, and historical comparisons. Stocks only (no crypto/ETF). Free: basic fields. Plus: expanded fields. Pro: all fields.", {
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
            .describe("Max results to return (1-100). Default: 20"),
        sector: z
            .string()
            .optional()
            .describe("Filter by sector name, e.g. Technology"),
        market_cap_tier: z
            .enum(["nano", "micro", "small", "mid", "large", "mega", "ultra_mega"])
            .optional()
            .describe("Filter by market cap tier"),
        direction: z
            .enum(["undervalued", "overvalued", "all"])
            .optional()
            .describe("Filter by valuation direction. Default: all"),
        min_severity: z
            .enum(["deep_value", "deeply_overvalued"])
            .optional()
            .describe("Only return the most extreme valuations"),
        sort_by: z
            .enum(["valuation_percentile", "pe_vs_history"])
            .optional()
            .describe("Sort order. Default: valuation_percentile"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    }, async ({ timeframe, limit, sector, market_cap_tier, direction, min_severity, sort_by, date }) => {
        const params = {
            timeframe,
            limit: limit?.toString(),
            sector,
            market_cap_tier,
            direction,
            min_severity,
            sort_by,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, "/scan/valuation", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
