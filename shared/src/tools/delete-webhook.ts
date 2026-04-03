import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerDeleteWebhook(server: McpServer, apiKey: string) {
  server.tool(
    "delete_webhook",
    "Remove a registered webhook.",
    {
      id: z
        .string()
        .describe("Webhook ID to remove"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ id }) => {
      const { status, data } = await callTickerApi(
        apiKey,
        "/webhooks",
        undefined,
        { method: "DELETE", body: { id } },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
