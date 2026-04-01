import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerScanOversold(server, apiKey) {
    server.tool("scan_oversold", "Scan for assets in oversold conditions based on RSI and other technical indicators. Returns assets ranked by severity with condition rarity context. Free: basic fields. Plus: expanded fields. Pro: all fields.", {
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
        asset_class: z
            .enum(["stock", "crypto", "etf", "all"])
            .optional()
            .describe("Filter by asset class. Default: all"),
        market_cap_tier: z
            .enum(["nano", "micro", "small", "mid", "large", "mega", "ultra_mega"])
            .optional()
            .describe("Filter by exact market cap tier"),
        min_market_cap_tier: z
            .enum(["nano", "micro", "small", "mid", "large", "mega", "ultra_mega"])
            .optional()
            .describe("Minimum market cap tier — returns this tier and all larger (e.g. mid returns mid, large, mega, ultra_mega)"),
        min_severity: z
            .enum(["deep_oversold"])
            .optional()
            .describe("Only return deep_oversold assets"),
        sort_by: z
            .enum(["severity", "days_oversold", "condition_percentile"])
            .optional()
            .describe("Sort order. Default: severity"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    }, async ({ timeframe, limit, sector, asset_class, market_cap_tier, min_market_cap_tier, min_severity, sort_by, date }) => {
        const params = {
            timeframe,
            limit: limit?.toString(),
            sector,
            asset_class,
            market_cap_tier,
            min_market_cap_tier,
            min_severity,
            sort_by,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, "/scan/oversold", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
