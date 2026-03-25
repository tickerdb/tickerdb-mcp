import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTickerApiServer } from "tickerapi-mcp-shared";

const apiKey = process.env.TICKERAPI_KEY;

if (!apiKey) {
  console.error(
    "Error: TICKERAPI_KEY environment variable is required.\n" +
      "Set it in your Claude Desktop config or export it in your shell.\n\n" +
      "Example Claude Desktop config:\n" +
      JSON.stringify(
        {
          mcpServers: {
            tickerapi: {
              command: "npx",
              args: ["@tickerapi/mcp-server"],
              env: { TICKERAPI_KEY: "YOUR_API_KEY" },
            },
          },
        },
        null,
        2,
      ),
  );
  process.exit(1);
}

if (!apiKey.startsWith("tapi_")) {
  console.error(
    "Error: Invalid API key format. Keys start with tapi_.\n" +
      "Get one at https://tickerapi.ai/dashboard",
  );
  process.exit(1);
}

const server = createTickerApiServer(apiKey);
const transport = new StdioServerTransport();
await server.connect(transport);
