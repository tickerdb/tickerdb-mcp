import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetAccount(server: McpServer, apiKey: string) {
  server.tool(
    "get_account",
    "Get your account details including current plan tier, rate limits, and today's API usage.",
    {},
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerApi(apiKey, "/account");

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
