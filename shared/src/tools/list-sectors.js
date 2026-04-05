import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerListSectors(server, apiKey) {
    server.tool("list_sectors", "List valid sector names for use as scan filters. Call this to discover exact sector values. No rate limit.", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        const { status, data } = await callTickerDb(apiKey, "/list/sectors");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
