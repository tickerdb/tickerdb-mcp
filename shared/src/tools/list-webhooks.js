import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListWebhooks(server, apiKey) {
    server.tool("list_webhooks", "List registered webhook URLs and their event subscriptions.", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        const { status, data } = await callTickerDb(apiKey, "/webhooks");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
