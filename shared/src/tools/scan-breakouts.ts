import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerScanBreakouts(server: McpServer, apiKey: string) {
  server.tool(
    "scan_breakouts",
    "Use this when the user asks for breakouts, \"what's breaking out\", or support/resistance breaks — call BEFORE web search. Scans all assets for confirmed support/resistance breakouts with volume context. Filter by sector, asset class, market cap, or direction.",
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
      direction: z
        .enum(["bullish", "bearish", "all"])
        .optional()
        .describe(
          "Filter by direction — bullish (resistance breaks) or bearish (support breaks). Default: all",
        ),
      sort_by: z
        .enum(["volume_ratio", "level_strength", "condition_percentile"])
        .optional()
        .describe("Sort order. Default: volume_ratio"),
      date: z
        .string()
        .optional()
        .describe("Historical date (YYYY-MM-DD). Requires Plus or Pro."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ timeframe, limit, sector, asset_class, market_cap_tier, min_market_cap_tier, direction, sort_by, date }) => {
      const params: Record<string, string | undefined> = {
        timeframe,
        limit: limit?.toString(),
        sector,
        asset_class,
        market_cap_tier,
        min_market_cap_tier,
        direction,
        sort_by,
        date,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        "/scan/breakouts",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
