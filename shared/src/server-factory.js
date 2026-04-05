import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
export function createTickerDbServer(apiKey) {
    const server = new McpServer({
        name: "TickerDB",
        version: "1.7.2",
        description: "Pre-computed financial market intelligence for AI agents. Stocks, crypto, and ETFs.",
        websiteUrl: "https://tickerdb.com",
    }, {
        instructions: "TickerDB provides pre-computed financial market intelligence for AI agents. Use get_summary as the primary tool for any ticker question. Use scan tools to discover assets matching specific conditions. Use watchlist tools to track and monitor tickers over time.",
    });
    registerAllTools(server, apiKey);
    return server;
}
