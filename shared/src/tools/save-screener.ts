import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { screenerFilterSchema, screenerSortSchema } from "./screener-schemas.js";

export function registerSaveScreener(server: McpServer, apiKey: string) {
  server.tool(
    "save_screener",
    "Create a saved screener for the user. Use get_schema first to validate field names and allowed values. The ticker field is always returned; returned fields are chosen automatically from filters, sort, and core defaults.",
    {
      name: z
        .string()
        .optional()
        .describe("Optional display name. If omitted, TickerDB generates one from the first filter."),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Candle timeframe. Default: daily."),
      filters: z
        .array(screenerFilterSchema)
        .min(1)
        .describe("Filters that define the screener."),
      sort: screenerSortSchema
        .optional()
        .describe("Optional server-side sort."),
      limit_count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Saved display limit. Default: 30, max: 50."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ name, timeframe, filters, sort, limit_count }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        {
          method: "POST",
          body: { name, timeframe, filters, sort, limit_count },
        },
      );

      if (status !== 201) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
