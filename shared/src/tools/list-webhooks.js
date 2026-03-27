import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListWebhooks(server, apiKey) {
    server.tool("list_webhooks", "List all registered webhook URLs and their event subscriptions.", {}, async () => {
        const { status, data } = await callTickerApi(apiKey, "/webhooks");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
