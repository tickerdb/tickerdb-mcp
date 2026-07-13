import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerDeleteScreener(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "delete_screener",
    "Delete a custom screener or hide a default preset from your list. For custom screeners (kind=custom) the record is permanently deleted. For default presets (kind=default) the screener is hidden from your list but can be restored by creating a screener with the same filters. Use list_screeners to find screener ids and kinds.",
    {
      id: z
        .string()
        .describe("Required. Screener id from list_screeners or create_screener."),
      kind: z
        .enum(["custom", "default"])
        .optional()
        .describe("Whether this is a custom or default screener. Default: custom."),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, kind }) => {
      const body: Record<string, unknown> = { id };
      if (kind) body.kind = kind;

      const { status, data } = await callTickerDb(
        apiKey,
        "/screeners",
        undefined,
        { method: "DELETE", body },
      );

      if (status < 200 || status >= 300) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
