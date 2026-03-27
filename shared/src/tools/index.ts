import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetSummary } from "./get-summary.js";
import { registerCompareAssets } from "./compare-assets.js";
import { registerListAssets } from "./list-assets.js";
import { registerGetWatchlist } from "./get-watchlist.js";
import { registerScanOversold } from "./scan-oversold.js";
import { registerScanBreakouts } from "./scan-breakouts.js";
import { registerScanUnusualVolume } from "./scan-unusual-volume.js";
import { registerScanValuation } from "./scan-valuation.js";
import { registerScanInsiderActivity } from "./scan-insider-activity.js";
import { registerCreateWebhook } from "./create-webhook.js";
import { registerListWebhooks } from "./list-webhooks.js";
import { registerDeleteWebhook } from "./delete-webhook.js";

export function registerAllTools(server: McpServer, apiKey: string) {
  registerGetSummary(server, apiKey);
  registerCompareAssets(server, apiKey);
  registerListAssets(server, apiKey);
  registerGetWatchlist(server, apiKey);
  registerScanOversold(server, apiKey);
  registerScanBreakouts(server, apiKey);
  registerScanUnusualVolume(server, apiKey);
  registerScanValuation(server, apiKey);
  registerScanInsiderActivity(server, apiKey);
  registerCreateWebhook(server, apiKey);
  registerListWebhooks(server, apiKey);
  registerDeleteWebhook(server, apiKey);
}
