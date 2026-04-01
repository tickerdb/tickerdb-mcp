import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerScanUnusualVolume(server, apiKey) {
    server.tool("scan_unusual_volume", "Scan for assets with unusual trading volume relative to their historical average. Returns volume ratio bands and price direction context. Free: basic fields. Plus: expanded fields. Pro: all fields.", {
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
        min_ratio_band: z
            .enum(["above_average", "high", "extremely_high"])
            .optional()
            .describe("Minimum volume ratio band threshold. Default: above_average"),
        sort_by: z
            .enum(["volume_percentile"])
            .optional()
            .describe("Sort order. Default: volume_percentile"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    }, async ({ timeframe, limit, sector, asset_class, market_cap_tier, min_market_cap_tier, min_ratio_band, sort_by, date }) => {
        const params = {
            timeframe,
            limit: limit?.toString(),
            sector,
            asset_class,
            market_cap_tier,
            min_market_cap_tier,
            min_ratio_band,
            sort_by,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, "/scan/unusual-volume", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
