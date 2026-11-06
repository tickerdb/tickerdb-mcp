// Experimental hybrid MCP server (see src/hybrid/server.ts). Same env as the
// standard local server: TICKERDB_KEY, TICKERDB_API_BASE.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHybridServer } from "./hybrid/server.js";

const server = createHybridServer(process.env.TICKERDB_KEY ?? "");
await server.connect(new StdioServerTransport());
