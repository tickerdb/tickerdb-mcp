import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";

const apiKey = process.env.TICKERDB_KEY;

if (!apiKey) {
  console.error(
    "Error: TICKERDB_KEY environment variable is required.\n" +
      "Set it in your Claude Desktop config or export it in your shell.\n\n" +
      "Example Claude Desktop config:\n" +
      JSON.stringify(
        {
          mcpServers: {
            tickerdb: {
              command: "npx",
              args: ["tickerdb-mcp"],
              env: { TICKERDB_KEY: "YOUR_API_KEY" },
            },
          },
        },
        null,
        2,
      ),
  );
  process.exit(1);
}

if (!apiKey.startsWith("ta_")) {
  console.error(
    "Error: Invalid API key format. Keys start with ta_.\n" +
      "Get one at https://tickerdb.com/dashboard",
  );
  process.exit(1);
}

const server = createTickerDbServer(apiKey);
const transport = new StdioServerTransport();
await server.connect(transport);
