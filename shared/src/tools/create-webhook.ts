import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerCreateWebhook(server: McpServer, apiKey: string) {
  server.tool(
    "create_webhook",
    "Register a webhook URL to receive push notifications when your watchlist changes or fresh data is available. The secret is only shown once — save it immediately.",
    {
      url: z
        .string()
        .describe("HTTPS URL to receive webhook payloads"),
      events: z
        .object({})
        .passthrough()
        .optional()
        .describe("Optional event subscriptions"),
    },
    async ({ url, events }) => {
      const body: Record<string, unknown> = { url };
      if (events) body.events = events;

      const { status, data } = await callTickerApi(
        apiKey,
        "/webhooks",
        undefined,
        { method: "POST", body },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify(data) +
              "\n\n⚠️ Save the secret above — it will not be shown again.",
          },
        ],
      };
    },
  );
}
