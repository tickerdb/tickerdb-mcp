import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerListWebhooks(server: McpServer, apiKey: string) {
  server.tool(
    "list_webhooks",
    "List registered webhook URLs and their event subscriptions.",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerApi(
        apiKey,
        "/webhooks",
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
