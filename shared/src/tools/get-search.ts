import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetSearch(server: McpServer, apiKey: string) {
  server.tool(
    "get_search",
    "Search for assets matching filter criteria. Use this when the user wants to find tickers by categorical state (e.g. 'which stocks are oversold?', 'find tech stocks in strong uptrend'). Pass filters as a JSON-encoded array of {field, op, value} objects. Call get_schema first to discover valid field names — fields use full expanded names (e.g. 'momentum_rsi_zone' not 'rsi_zone', 'volatility_regime' not 'vol_regime').",
    {
      filters: z
        .string()
        .describe(
          'JSON-encoded filter array. Each filter: {"field": "column_name", "op": "eq|neq|in|gt|gte|lt|lte", "value": "..."}. Example: [{"field": "momentum_rsi_zone", "op": "in", "value": ["oversold", "deep_oversold"]}, {"field": "sector", "op": "eq", "value": "Technology"}]',
        ),
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
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ filters, timeframe, limit, offset }) => {
      const params: Record<string, string | undefined> = {
        filters,
        timeframe,
        limit: limit?.toString(),
        offset: offset?.toString(),
      };
      const { status, data } = await callTickerDb(
        apiKey,
        "/search",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
