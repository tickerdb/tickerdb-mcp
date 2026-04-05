import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerScanValuation(server: McpServer, apiKey: string) {
  server.tool(
    "scan_valuation",
    "Use this when the user asks about undervalued/overvalued stocks, valuation screens, or \"what's cheap\" — call BEFORE web search. Scans stocks for valuation extremes based on PE ratios, growth metrics, and historical comparisons. Results include valuation_stability (Plus/Pro) and flips_recent (Plus/Pro). Stocks only (no crypto/ETF).",
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
      market_cap_tier: z
        .enum(["nano", "micro", "small", "mid", "large", "mega", "ultra_mega"])
        .optional()
        .describe("Filter by exact market cap tier"),
      min_market_cap_tier: z
        .enum(["nano", "micro", "small", "mid", "large", "mega", "ultra_mega"])
        .optional()
        .describe("Minimum market cap tier — returns this tier and all larger (e.g. mid returns mid, large, mega, ultra_mega)"),
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
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ timeframe, limit, sector, market_cap_tier, min_market_cap_tier, direction, min_severity, sort_by, date }) => {
      const params: Record<string, string | undefined> = {
        timeframe,
        limit: limit?.toString(),
        sector,
        market_cap_tier,
        min_market_cap_tier,
        direction,
        min_severity,
        sort_by,
        date,
      };
      const { status, data } = await callTickerDb(
        apiKey,
        "/scan/valuation",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
