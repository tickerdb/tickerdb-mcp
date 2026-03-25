import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerScanInsiderActivity(server, apiKey) {
    server.tool("scan_insider_activity", "Scan for stocks with notable insider buying or selling activity. Returns insider transaction zones, buy/sell counts, and shares traded. Requires Pro plan.", {
        timeframe: z
            .enum(["daily", "weekly"])
            .optional()
            .describe("Analysis timeframe. Default: daily"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Max results to return (1-50). Default: 20"),
        sector: z
            .string()
            .optional()
            .describe("Filter by sector name, e.g. Technology"),
        direction: z
            .enum(["buying", "selling", "all"])
            .optional()
            .describe("Filter by insider direction. Default: all"),
        sort_by: z
            .enum(["zone_severity", "shares_volume", "net_ratio"])
            .optional()
            .describe("Sort order. Default: zone_severity"),
        date: z
            .string()
            .optional()
            .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    }, async ({ timeframe, limit, sector, direction, sort_by, date }) => {
        const params = {
            timeframe,
            limit: limit?.toString(),
            sector,
            direction,
            sort_by,
            date,
        };
        const { status, data } = await callTickerApi(apiKey, "/scan/insider-activity", params);
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
