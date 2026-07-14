import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerUpdateScreener(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "update_screener",
    "Update an existing custom screener by id. Partial update: omit any field to keep its current value. Only custom screeners (kind=custom) can be updated; default presets are read-only. Use list_screeners to find screener ids.",
    {
      id: z
        .string()
        .describe("Required. Screener id from list_screeners or create_screener."),
      filters: z
        .string()
        .optional()
        .describe(
          'JSON-encoded filter array. Replaces the existing filters when provided. Each value filter: {"field": "column_name", "op": "eq|neq|in|gt|gte|lt|lte|exists", "value": "..."}. Each change filter: {"type": "change", "field": "column_name", "op": "changed", "from": "old_value", "to": "new_value"}.',
        ),
      name: z
        .string()
        .optional()
        .describe("New display name (max 120 chars)."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("New snapshot timeframe."),
      sort: z
        .string()
        .optional()
        .describe(
          'JSON-encoded sort object: {"field": "column_name", "direction": "asc"|"desc"}.',
        ),
      limit_count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("New max result count. 1-50."),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, filters, name, timeframe, sort, limit_count }) => {
      const body: Record<string, unknown> = { id };
      if (filters !== undefined) body.filters = JSON.parse(filters);
      if (name !== undefined) body.name = name;
      if (timeframe !== undefined) body.timeframe = timeframe;
      if (sort !== undefined) body.sort = JSON.parse(sort);
      if (limit_count !== undefined) body.limit_count = limit_count;

      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        { method: "PUT", body },
      );

      if (status < 200 || status >= 300) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
