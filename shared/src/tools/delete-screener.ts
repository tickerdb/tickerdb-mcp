import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerDeleteScreener(server: McpServer, apiKey: string) {
  server.tool(
    "delete_screener",
    "Delete a custom saved screener, or hide a built-in default screener from the user's dashboard. Call list_screeners first to get the id and kind.",
    {
      id: z.string().describe("Screener id from list_screeners."),
      kind: z
        .enum(["custom", "default"])
        .optional()
        .describe("Use 'default' to hide a built-in screener; default is custom."),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async ({ id, kind }) => {
      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        {
          method: "DELETE",
          body: { id, kind: kind ?? "custom" },
        },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
