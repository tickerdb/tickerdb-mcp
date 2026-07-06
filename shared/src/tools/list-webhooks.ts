import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerListWebhooks(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "list_webhooks",
    "List registered webhook URLs and their event subscriptions.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/webhooks",
      );

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
