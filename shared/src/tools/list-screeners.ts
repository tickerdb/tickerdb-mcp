import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerListScreeners(server: McpServer, apiKey: string) {
  server.tool(
    "list_screeners",
    "List the user's saved screeners and the built-in default screeners. Use this before editing or deleting a screener so you have the screener id.",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/screeners");

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
