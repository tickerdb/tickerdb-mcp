import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListAssets(server, apiKey) {
    server.tool("list_assets", "List all supported ticker symbols. Use this to check if a ticker is available before calling other tools. No rate limit.", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        const { status, data } = await callTickerDb(apiKey, "/assets");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
