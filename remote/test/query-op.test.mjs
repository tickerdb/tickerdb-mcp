// The query tool against a stubbed API (audit K4, 2026-11-23): date-range market
// queries page (fetch_all), dry_run is never dropped, local range filters follow
// /v1/search's null and type rules, one-date screens ask for at most 250 rows, and
// API errors keep their status, type and extras (K13).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
let shared;

test.before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "tickerdb-mcp-query-"));
  const outfile = join(dir, "shared.mjs");
  await build({ entryPoints: [join(ROOT, "shared", "src", "index.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
  try {
    shared = await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** An API stub: answer(url) -> { status, body }; records every request URL. */
function stubApi(answer) {
  const calls = [];
  shared.initApiClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const { status = 200, body } = answer(url);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  });
  return calls;
}

/** A store that keeps rows in memory (the DataStore surface runOp uses). */
function memoryStore() {
  const tables = new Map();
  return {
    tables,
    async autoName(prefix) { return `${prefix}_1`; },
    async begin(table, _source, append) { if (!append || !tables.has(table)) tables.set(table, []); },
    async insert(table, rows) { tables.get(table).push(...rows); },
    async summary(table) { return { table, row_count: tables.get(table).length }; },
  };
}

const ctx = (store) => ({ apiKey: "tdb_test", store, limits: { ...shared.DEFAULT_LIMITS, inlineMaxChars: 0 } });
const marketRange = { filters: [{ field: "market_regime_zone", op: "eq", value: "risk_off" }], fields: ["momentum_rsi"], start: "2020-01-01", end: "2020-12-31" };

test("a date range with a market filter pages /v1/search with fetch_all, 250 rows a page", async () => {
  const calls = stubApi((url) => {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const n = offset < 500 ? 250 : 7;
    return { body: { results: Array.from({ length: n }, (_, i) => ({ ticker: `T${offset + i}`, date: "2020-03-02" })) } };
  });
  const store = memoryStore();
  const result = await shared.runOp(ctx(store), shared.QUERY_OP, { ...marketRange }, { store_as: "r", fetch_all: true });
  assert.notEqual(result.isError, true, result.content[0].text);
  assert.equal(store.tables.get("r").length, 507);
  assert.deepEqual(calls.map((u) => [u.pathname, u.searchParams.get("limit"), u.searchParams.get("offset")]), [
    ["/v1/search", "250", null], ["/v1/search", "250", "250"], ["/v1/search", "250", "500"],
  ]);
});

test("inline, a full search page says there may be more", async () => {
  stubApi(() => ({ body: { results: Array.from({ length: 20 }, (_, i) => ({ ticker: `T${i}` })) } }));
  const result = await shared.runOp(ctx(undefined), shared.QUERY_OP, { ...marketRange }, {});
  assert.match(JSON.parse(result.content[0].text).more_pages, /A full page \(20 rows\)/);
});

test("dry_run and page_token are refused on a market-filter range, never dropped (a dropped dry_run charged the search)", async () => {
  const calls = stubApi(() => ({ body: { results: [] } }));
  for (const extra of [{ dry_run: true }, { page_token: "x" }]) {
    const result = await shared.runOp(ctx(undefined), shared.QUERY_OP, { ...marketRange, ...extra }, {});
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 0);
  // On /v1/history dry_run goes through.
  const history = stubApi(() => ({ body: { rows: [], dry_run: true } }));
  await shared.runOp(ctx(undefined), shared.QUERY_OP, { fields: ["momentum_rsi"], tickers: ["AAPL"], start: "2020-01-01", end: "2020-12-31", dry_run: true }, {});
  assert.equal(history[0].pathname, "/v1/history");
  assert.equal(history[0].searchParams.get("dry_run"), "true");
});

test("a one-date screen of many tickers asks for at most 250 rows; a larger limit is refused", async () => {
  const calls = stubApi(() => ({ body: { results: [] } }));
  const tickers = Array.from({ length: 400 }, (_, i) => `T${i}`);
  await shared.runOp(ctx(undefined), shared.QUERY_OP, { tickers, fields: ["momentum_rsi"] }, {});
  assert.equal(calls[0].searchParams.get("limit"), "250");
  const refused = await shared.runOp(ctx(undefined), shared.QUERY_OP, { tickers, fields: ["momentum_rsi"], limit: 500 }, {});
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /at most 250/);
});

test("local range filters follow /v1/search: null, numbers served as strings, booleans", () => {
  const m = shared.matches;
  assert.equal(m({ pe: "12.5" }, { field: "pe", op: "gt", value: 9 }), true);       // numeric, not "12.5" < "9"
  assert.equal(m({ pe: "12.5" }, { field: "pe", op: "lt", value: 100 }), true);
  assert.equal(m({ pe: null }, { field: "pe", op: "neq", value: 5 }), false);       // SQL: NULL != 5 is not true
  assert.equal(m({ pe: null }, { field: "pe", op: "eq", value: null }), true);      // IS NULL
  assert.equal(m({ pe: 3 }, { field: "pe", op: "neq", value: null }), true);        // IS NOT NULL
  assert.equal(m({}, { field: "pe", op: "eq", value: null }), true);
  assert.equal(m({ sq: 1 }, { field: "sq", op: "eq", value: true }), true);
  assert.equal(m({ sq: false }, { field: "sq", op: "neq", value: true }), true);
  assert.equal(m({ z: "oversold" }, { field: "z", op: "in", value: ["oversold", "deep_oversold"] }), true);
  assert.equal(m({ z: "oversold" }, { field: "z", op: "in", value: [] }), false);
  assert.equal(m({ pe: "n/a" }, { field: "pe", op: "neq", value: 5 }), false);
});

test("filters the API would refuse are refused before any call", async () => {
  const calls = stubApi(() => ({ body: { rows: [] } }));
  for (const bad of [
    { field: "momentum_rsi", op: "gt", value: "30" },
    { field: "momentum_rsi_zone", op: "in", value: "oversold" },
    { field: "volatility_squeeze_active", op: "gt", value: true },
  ]) {
    const result = await shared.runOp(ctx(undefined), shared.QUERY_OP, { filters: [bad], fields: ["momentum_rsi"], tickers: ["AAPL"], start: "2020-01-01", end: "2020-12-31" }, {});
    assert.equal(result.isError, true, JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
});

test("an API error keeps its status, type and extras", () => {
  const out = shared.formatApiError(402, { error: { type: "insufficient_credit_balance", message: "Credits used up.", credits_required: 3, credit_balance: 0, buy_credits_url: "https://tickerdb.com/dashboard" } });
  assert.equal(out.isError, true);
  const [first, second] = out.content[0].text.split("\n");
  assert.equal(first, "Credits used up.");
  assert.deepEqual(JSON.parse(second.replace(/^error: /, "")), {
    status: 402, type: "insufficient_credit_balance", credits_required: 3, credit_balance: 0, buy_credits_url: "https://tickerdb.com/dashboard",
  });
  const burst = shared.formatApiError(429, { error: { type: "rate_limit_exceeded", message: "Too many requests.", retry_after_seconds: 10 } });
  assert.match(burst.content[0].text, /"retry_after_seconds":10/);
});
