import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListAssets(server, apiKey) {
    server.tool("list_assets", "List all supported assets (stocks, crypto, ETFs) with their ticker symbols and asset classes. Use this to check if a specific ticker is available before calling other tools. No rate limit.", {}, async () => {
        const { status, data } = await callTickerApi(apiKey, "/assets");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
//# sourceMappingURL=list-assets.js.map