import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerCreateWebhook(server, apiKey) {
    server.tool("create_webhook", "Register a webhook URL for push notifications on watchlist changes. The secret is only shown once.", {
        url: z
            .string()
            .describe("HTTPS URL to receive webhook payloads"),
        events: z
            .object({})
            .passthrough()
            .optional()
            .describe("Optional event subscriptions"),
    }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, async ({ url, events }) => {
        const body = { url };
        if (events)
            body.events = events;
        const { status, data } = await callTickerDb(apiKey, "/webhooks", undefined, { method: "POST", body });
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(data) +
                        "\n\n⚠️ Save the secret above — it will not be shown again.",
                },
            ],
        };
    });
}
