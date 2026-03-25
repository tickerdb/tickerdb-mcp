import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createTickerApiServer(apiKey: string): McpServer {
  const server = new McpServer({
    name: "TickerAPI",
    version: "1.0.0",
  });

  registerAllTools(server, apiKey);
  return server;
}
