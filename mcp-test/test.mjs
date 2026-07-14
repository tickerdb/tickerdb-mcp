/**
 * Staging MCP smoke test
 * Usage: TICKERDB_KEY=tdb_... node test.mjs
 */

const BASE = "https://tickerdb-mcp-staging.tickerdbcom-f33.workers.dev/mcp";
const KEY = process.env.TICKERDB_KEY;

if (!KEY) {
  console.error("Set TICKERDB_KEY env var first.\nExample: TICKERDB_KEY=tdb_... node test.mjs");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${KEY}`,
};

let passed = 0;
let failed = 0;

async function rpc(id, method, params = {}) {
  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return res.json();
}

async function callTool(id, name, args = {}) {
  return rpc(id, "tools/call", { name, arguments: args });
}

function pass(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}`);
  if (detail) console.error(`    ${JSON.stringify(detail).slice(0, 200)}`);
  failed++;
}

function check(label, condition, detail) {
  condition ? pass(label) : fail(label, detail);
}

// ── tools/list ────────────────────────────────────────────────────────────────
console.log("\n[1] tools/list");
const listRes = await rpc(1, "tools/list");
const toolNames = (listRes.result?.tools ?? []).map(t => t.name);
const EXPECTED_TOOLS = [
  "get_summary", "get_ohlcv", "get_search", "get_schema",
  "get_watchlist", "get_watchlist_changes", "add_to_watchlist", "remove_from_watchlist",
  "get_account",
  "create_webhook", "list_webhooks", "delete_webhook", "update_webhook", "list_webhook_deliveries",
  "list_screeners", "create_screener", "update_screener", "delete_screener",
];
check(`18 tools registered (got ${toolNames.length})`, toolNames.length === 18, toolNames);
for (const name of EXPECTED_TOOLS) {
  check(`  tool present: ${name}`, toolNames.includes(name));
}

// ── get_search: no offset param ───────────────────────────────────────────────
console.log("\n[2] get_search — offset param removed");
const searchTool = listRes.result?.tools?.find(t => t.name === "get_search");
const hasOffset = JSON.stringify(searchTool?.inputSchema ?? {}).includes("offset");
check("offset param absent from get_search schema", !hasOffset);

// ── get_account ───────────────────────────────────────────────────────────────
console.log("\n[3] get_account");
const accountRes = await callTool(3, "get_account");
const accountText = accountRes.result?.content?.[0]?.text ?? "";
const account = JSON.parse(accountText);
check("returns tier", !!account.tier);
check("returns usage.credit_balance", "credit_balance" in (account.usage ?? {}));
check("returns limits.overage_enabled", "overage_enabled" in (account.limits ?? {}));

// ── list_screeners ────────────────────────────────────────────────────────────
console.log("\n[4] list_screeners");
const screenersRes = await callTool(4, "list_screeners");
const screenersText = screenersRes.result?.content?.[0]?.text ?? "";
const screeners = JSON.parse(screenersText);
const defaultIds = (screeners.defaults ?? []).map(s => s.id);
check("returns defaults array", Array.isArray(screeners.defaults));
for (const id of ["oversold", "volume_surging", "breakout_watch", "valuation_reset", "trend_leaders"]) {
  check(`  preset present: ${id}`, defaultIds.includes(id));
}
check("returns fields schema", Array.isArray(screeners.fields));

// ── create_screener → update_screener → delete_screener ───────────────────────
console.log("\n[5] create_screener");
const createRes = await callTool(5, "create_screener", {
  filters: JSON.stringify([{ field: "momentum_rsi_zone", op: "in", value: ["oversold", "deep_oversold"] }]),
  name: "MCP test screener",
  timeframe: "daily",
});
const createText = createRes.result?.content?.[0]?.text ?? "";
const created = JSON.parse(createText);
const screenerId = created.screener?.id;
check("screener created with id", !!screenerId);
check("screener name matches", created.screener?.name === "MCP test screener");

console.log("\n[6] update_screener");
const updateRes = await callTool(6, "update_screener", {
  id: screenerId,
  name: "MCP test screener (updated)",
});
const updateText = updateRes.result?.content?.[0]?.text ?? "";
const updated = JSON.parse(updateText);
check("screener updated", updated.screener?.name === "MCP test screener (updated)");

console.log("\n[7] delete_screener");
const deleteRes = await callTool(7, "delete_screener", { id: screenerId, kind: "custom" });
const deleteText = deleteRes.result?.content?.[0]?.text ?? "";
const deleted = JSON.parse(deleteText);
check("screener deleted", deleted.deleted === true);

// ── get_search with new fields ────────────────────────────────────────────────
console.log("\n[8] get_search — new fields");
const searchRes = await callTool(8, "get_search", {
  filters: JSON.stringify([{ field: "momentum_rsi_zone", op: "in", value: ["oversold", "deep_oversold"] }]),
  fields: JSON.stringify(["ticker", "momentum_rsi_zone", "sector_agreement", "volatility_squeeze_active"]),
  limit: 3,
});
const searchText = searchRes.result?.content?.[0]?.text ?? "";
const search = JSON.parse(searchText);
check("returns results array", Array.isArray(search.results));
check("results contain sector_agreement field", search.fields?.includes("sector_agreement"));

// ── list_webhook_deliveries ───────────────────────────────────────────────────
console.log("\n[9] list_webhook_deliveries");
const deliveriesRes = await callTool(9, "list_webhook_deliveries", { limit: 5 });
const deliveriesText = deliveriesRes.result?.content?.[0]?.text ?? "";
const deliveries = JSON.parse(deliveriesText);
check("returns deliveries array", Array.isArray(deliveries.deliveries));

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
