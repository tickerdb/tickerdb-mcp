import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
export function registerGetSchema(server, apiKey) {
    server.tool("get_schema", "Get the schema of all available fields and their valid band values. Use this when the user asks 'what fields are available?', 'what bands does rsi_zone have?', 'what sectors exist?', or when you need to validate field/band names before calling get_summary with event parameters or get_search with filters.", {}, { readOnlyHint: true, openWorldHint: true }, async () => {
        const { status, data } = await callTickerDb(apiKey, "/schema/fields");
        if (status !== 200)
            return formatApiError(status, data);
        return {
            content: [{ type: "text", text: JSON.stringify(data) }],
        };
    });
}
