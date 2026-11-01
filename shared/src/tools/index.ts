import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetSummary } from "./get-summary.js";
import { registerGetOhlcv } from "./get-ohlcv.js";
import { registerGetSearch } from "./get-search.js";
import { registerGetSchema } from "./get-schema.js";
import { registerGetMarket } from "./get-market.js";
import { registerGetAccount } from "./get-account.js";
import { registerGetChanges } from "./get-changes.js";
import { registerGetUniverse } from "./get-universe.js";
export function registerAllTools(server: McpServer, apiKey: string) {
  registerGetSummary(server, apiKey);
  registerGetOhlcv(server, apiKey);
  registerGetSearch(server, apiKey);
  registerGetSchema(server, apiKey);
  registerGetMarket(server, apiKey);
  registerGetAccount(server, apiKey);
  registerGetChanges(server, apiKey);
  registerGetUniverse(server, apiKey);
}
