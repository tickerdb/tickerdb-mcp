import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { screenerFilterSchema, screenerSortSchema } from "./screener-schemas.js";

export function registerEditScreener(server: McpServer, apiKey: string) {
  server.tool(
    "edit_screener",
    "Edit a custom saved screener. Call list_screeners first to get the custom screener id. Built-in default screeners cannot be edited; create a new custom screener instead.",
    {
      id: z.string().describe("Custom screener id from list_screeners."),
      name: z.string().optional().describe("New display name."),
      timeframe: z.enum(["daily", "weekly"]).optional().describe("New candle timeframe."),
      filters: z.array(screenerFilterSchema).min(1).optional().describe("Replacement filters."),
      sort: screenerSortSchema.optional().describe("Replacement sort."),
      limit_count: z.number().int().min(1).max(50).optional().describe("Saved display limit. Max: 50."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ id, name, timeframe, filters, sort, limit_count }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        {
          method: "PUT",
          body: { id, name, timeframe, filters, sort, limit_count },
        },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
