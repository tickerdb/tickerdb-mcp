import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListSectors(server, apiKey) {
    server.tool("list_sectors", "List all valid sector values with asset counts. Use this to discover exact sector names before filtering scan results by sector. No rate limit.", {}, async () => {
        const { status, data } = await callTickerApi(apiKey, "/list/sectors");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
