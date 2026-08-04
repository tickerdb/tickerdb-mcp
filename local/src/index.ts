import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";

const apiKey = process.env.TICKERDB_KEY ?? "";

const server = createTickerDbServer(apiKey);
const transport = new StdioServerTransport();
await server.connect(transport);
