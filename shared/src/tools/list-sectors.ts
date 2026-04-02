import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerListSectors(server: McpServer, apiKey: string) {
  server.tool(
    "list_sectors",
    "List valid sector names for use as scan filters. Call this to discover exact sector values. No rate limit.",
    {},
    async () => {
      const { status, data } = await callTickerApi(apiKey, "/list/sectors");

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
