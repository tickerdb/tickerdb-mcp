import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetSummary } from "./get-summary.js";
import { registerGetSearch } from "./get-search.js";
import { registerGetSchema } from "./get-schema.js";
import { registerGetWatchlist } from "./get-watchlist.js";
import { registerGetWatchlistChanges } from "./get-watchlist-changes.js";
import { registerAddToWatchlist } from "./add-to-watchlist.js";
import { registerRemoveFromWatchlist } from "./remove-from-watchlist.js";
import { registerGetAccount } from "./get-account.js";
import { registerCreateWebhook } from "./create-webhook.js";
import { registerListWebhooks } from "./list-webhooks.js";
import { registerDeleteWebhook } from "./delete-webhook.js";

export function registerAllTools(server: McpServer, apiKey: string) {
  registerGetSummary(server, apiKey);
  registerGetSearch(server, apiKey);
  registerGetSchema(server, apiKey);
  registerGetWatchlist(server, apiKey);
  registerGetWatchlistChanges(server, apiKey);
  registerAddToWatchlist(server, apiKey);
  registerRemoveFromWatchlist(server, apiKey);
  registerGetAccount(server, apiKey);
  registerCreateWebhook(server, apiKey);
  registerListWebhooks(server, apiKey);
  registerDeleteWebhook(server, apiKey);
}
