import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerListWebhookDeliveries(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "list_webhook_deliveries",
    "List recent webhook delivery history. Each entry shows the event type, timeframe, run date, delivery status, HTTP status code, attempt count, and any error message. Use this to debug failed or missing deliveries. Results are ordered newest-first.",
    {
      webhook_id: z
        .string()
        .optional()
        .describe("Filter to a specific webhook by id. Omit to return deliveries across all your webhooks."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max deliveries to return. Default: 50, max: 200."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ webhook_id, limit }) => {
      const params: Record<string, string | undefined> = {
        webhook_id,
        limit: limit?.toString(),
      };

      const { status, data } = await callTickerDb(
        apiKey,
        "/webhooks/deliveries",
        params,
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
