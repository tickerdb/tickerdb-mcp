import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetSummary } from "./get-summary.js";
import { registerGetOhlcv } from "./get-ohlcv.js";
import { registerGetSearch } from "./get-search.js";
import { registerGetSchema } from "./get-schema.js";
import { registerGetAccount } from "./get-account.js";
export function registerAllTools(server: McpServer, apiKey: string) {
  registerGetSummary(server, apiKey);
  registerGetOhlcv(server, apiKey);
  registerGetSearch(server, apiKey);
  registerGetSchema(server, apiKey);
  registerGetAccount(server, apiKey);
}
