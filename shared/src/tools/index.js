import { registerGetSummary } from "./get-summary.js";
import { registerCompareAssets } from "./compare-assets.js";
import { registerListAssets } from "./list-assets.js";
import { registerGetWatchlist } from "./get-watchlist.js";
import { registerScanOversold } from "./scan-oversold.js";
import { registerScanBreakouts } from "./scan-breakouts.js";
import { registerScanUnusualVolume } from "./scan-unusual-volume.js";
import { registerScanValuation } from "./scan-valuation.js";
import { registerScanInsiderActivity } from "./scan-insider-activity.js";
export function registerAllTools(server, apiKey) {
    registerGetSummary(server, apiKey);
    registerCompareAssets(server, apiKey);
    registerListAssets(server, apiKey);
    registerGetWatchlist(server, apiKey);
    registerScanOversold(server, apiKey);
    registerScanBreakouts(server, apiKey);
    registerScanUnusualVolume(server, apiKey);
    registerScanValuation(server, apiKey);
    registerScanInsiderActivity(server, apiKey);
}
