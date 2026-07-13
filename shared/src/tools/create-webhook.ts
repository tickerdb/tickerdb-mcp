import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerCreateWebhook(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "create_webhook",
    "Register a webhook URL to receive push notifications from TickerDB. Valid event types are 'watchlist.changes' (fires after each daily/weekly pipeline run when your watchlist tickers have state changes — enabled by default) and 'data.ready' (fires when fresh market data has been ingested). The secret is only shown once at creation time; save it to verify payload signatures.",
    {
      url: z
        .string()
        .describe("HTTPS URL to receive webhook payloads"),
      events: z
        .record(z.boolean())
        .optional()
        .describe(
          'Optional event subscription map. Valid keys: "watchlist.changes" (enabled by default), "data.ready". Example: {"watchlist.changes": true, "data.ready": false}. Omit to use the default (watchlist.changes only).',
        ),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ url, events }) => {
      const body: Record<string, unknown> = { url };
      if (events) body.events = events;

      const { status, data } = await callTickerDb(
        apiKey,
        "/webhooks",
        undefined,
        { method: "POST", body },
      );

      if (status < 200 || status >= 300) return formatApiError(status, data);

      return formatTickerDbResult(
        data,
        `${JSON.stringify(data)}\n\nSave the secret above; it will not be shown again.`,
      );
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
