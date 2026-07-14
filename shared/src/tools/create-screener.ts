import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerCreateScreener(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "create_screener",
    "Save a custom screener for reuse. Provide at least one filter; the screener is stored and assigned an id that can be referenced later via list_screeners or update_screener. To execute the screener, pass its filters and sort to get_search.",
    {
      filters: z
        .string()
        .describe(
          'Required. JSON-encoded filter array. Up to 12 filters. Each value filter: {"field": "column_name", "op": "eq|neq|in|gt|gte|lt|lte|exists", "value": "..."}. Each change filter: {"type": "change", "field": "column_name", "op": "changed", "from": "old_value", "to": "new_value"}. Example: [{"field": "momentum_rsi_zone", "op": "in", "value": ["oversold", "deep_oversold"]}, {"field": "sector", "op": "eq", "value": "Technology"}]. Use get_schema to discover valid field names and allowed values.',
        ),
      name: z
        .string()
        .optional()
        .describe("Display name for the screener (max 120 chars). Auto-derived from the first filter if omitted."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Snapshot timeframe the screener runs against. Default: daily."),
      sort: z
        .string()
        .optional()
        .describe(
          'JSON-encoded sort object: {"field": "column_name", "direction": "asc"|"desc"}. Example: {"field": "market_cap", "direction": "desc"}.',
        ),
      limit_count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results when the screener is executed. 1-50, default 30."),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ filters, name, timeframe, sort, limit_count }) => {
      const body: Record<string, unknown> = { filters: JSON.parse(filters) };
      if (name) body.name = name;
      if (timeframe) body.timeframe = timeframe;
      if (sort) body.sort = JSON.parse(sort);
      if (limit_count !== undefined) body.limit_count = limit_count;

      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        { method: "POST", body },
      );

      if (status < 200 || status >= 300) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
