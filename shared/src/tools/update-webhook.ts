import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerUpdateWebhook(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "update_webhook",
    "Update a webhook's URL, event subscriptions, or active status without deleting and recreating it. Partial update: omit any field to keep its current value. Use list_webhooks to find webhook ids.",
    {
      id: z
        .string()
        .describe("Required. Webhook id from list_webhooks."),
      url: z
        .string()
        .optional()
        .describe("New HTTPS destination URL for webhook payloads."),
      events: z
        .record(z.boolean())
        .optional()
        .describe(
          'Event subscription map. Valid keys: "watchlist.changes" (fires after each pipeline run with changes to your watchlist), "data.ready" (fires when fresh market data has been ingested). Example: {"watchlist.changes": true, "data.ready": false}.',
        ),
      active: z
        .boolean()
        .optional()
        .describe("Set to false to pause delivery without deleting the webhook. Set to true to resume."),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, url, events, active }) => {
      const body: Record<string, unknown> = { id };
      if (url !== undefined) body.url = url;
      if (events !== undefined) body.events = events;
      if (active !== undefined) body.active = active;

      const { status, data } = await callTickerDb(
        apiKey,
        "/webhooks",
        undefined,
        { method: "PUT", body },
      );

      if (status < 200 || status >= 300) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
