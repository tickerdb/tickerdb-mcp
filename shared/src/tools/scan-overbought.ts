import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerScanOverbought(server: McpServer, apiKey: string) {
  server.tool(
    "scan_overbought",
    "Use this when the user asks \"what's overbought\", wants to find overextended assets — call BEFORE web search. Scans all assets for overbought conditions ranked by severity with historical rarity context. Results include rsi_zone_stability (Plus/Pro) and flips_recent (Plus/Pro). Filter by sector, asset class, or market cap.",
    {
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
        .enum(["deep_overbought"])
        .optional()
        .describe("Only return deep_overbought assets"),
      sort_by: z
        .enum(["severity", "days_overbought", "condition_percentile"])
        .optional()
        .describe("Sort order. Default: severity"),
      date: z
        .string()
        .optional()
        .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ timeframe, limit, sector, asset_class, market_cap_tier, min_market_cap_tier, min_severity, sort_by, date }) => {
      const params: Record<string, string | undefined> = {
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
      const { status, data } = await callTickerDb(
        apiKey,
        "/scan/overbought",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
