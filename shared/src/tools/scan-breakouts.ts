import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerScanBreakouts(server: McpServer, apiKey: string) {
  server.tool(
    "scan_breakouts",
    "Scan for assets breaking through support or resistance levels. Returns breakout type, level details, and volume confirmation. Free: basic fields. Plus: expanded fields. Pro: all fields.",
    {
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
      asset_class: z
        .enum(["stock", "crypto", "etf", "all"])
        .optional()
        .describe("Filter by asset class. Default: all"),
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
    async ({ timeframe, limit, sector, asset_class, direction, sort_by, date }) => {
      const params: Record<string, string | undefined> = {
        timeframe,
        limit: limit?.toString(),
        sector,
        asset_class,
        direction,
        sort_by,
        date,
      };
      const { status, data } = await callTickerApi(
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
