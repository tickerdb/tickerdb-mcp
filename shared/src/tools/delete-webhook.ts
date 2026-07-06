import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerDeleteWebhook(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "delete_webhook",
    "Remove a registered webhook.",
    {
      id: z
        .string()
        .describe("Webhook ID to remove"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ id }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/webhooks",
        undefined,
        { method: "DELETE", body: { id } },
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
