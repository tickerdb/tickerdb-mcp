// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTickerApiServer } from "tickerapi-mcp-shared";
var apiKey = process.env.TICKERAPI_KEY;
if (!apiKey) {
  console.error(
    "Error: TICKERAPI_KEY environment variable is required.\nSet it in your Claude Desktop config or export it in your shell.\n\nExample Claude Desktop config:\n" + JSON.stringify(
      {
        mcpServers: {
          tickerapi: {
            command: "npx",
            args: ["@tickerapi/mcp-server"],
            env: { TICKERAPI_KEY: "YOUR_API_KEY" }
          }
        }
      },
      null,
      2
    )
  );
  process.exit(1);
}
if (!apiKey.startsWith("tapi_")) {
  console.error(
    "Error: Invalid API key format. Keys start with tapi_.\nGet one at https://tickerapi.ai/dashboard"
  );
  process.exit(1);
}
var server = createTickerApiServer(apiKey);
var transport = new StdioServerTransport();
await server.connect(transport);
