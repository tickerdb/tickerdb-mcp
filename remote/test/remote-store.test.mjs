// The Worker's store_as / query_data on the real Durable Object store (workerd via
// wrangler), with the TickerDB API stubbed inside the Worker (store-worker.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { unstable_dev } from "wrangler";

let worker;
let id = 0;

test.before(async () => {
  worker = await unstable_dev("remote/test/store-worker.ts", {
    config: "remote/test/store-wrangler.jsonc",
    inspect: false,
    local: true,
    logLevel: "none",
    experimental: { disableDevRegistry: true, disableExperimentalWarning: true, testMode: true, watch: false },
  });
});

test.after(async () => {
  await worker?.stop();
});

async function rpc(method, params, key = "tdb_remote_store_test") {
  const res = await worker.fetch("http://localhost/mcp", {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).result;
}

async function call(name, args, key) {
  const result = await rpc("tools/call", { name, arguments: args }, key);
  const text = result.content[0].text;
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { result, text, json };
}

async function sql(query, extra = {}, key) {
  const { result, json, text } = await call("query_data", { sql: query, ...extra }, key);
  assert.notEqual(result.isError, true, text);
  return json;
}

test("remote serves the same tools; query_data has format but no output_path", async () => {
  const { tools } = await rpc("tools/list", {});
  assert.deepEqual(tools.map((t) => t.name).sort(), ["call_tool", "get_market", "get_ohlcv", "get_schema", "get_summary", "query", "query_data", "search_tools"]);
  const qd = tools.find((t) => t.name === "query_data");
  assert.deepEqual(Object.keys(qd.inputSchema.properties).sort(), ["format", "max_rows", "sql"]);
  for (const t of tools) assert.deepEqual(t._meta?.securitySchemes, [{ type: "oauth2", scopes: ["tickerdb"] }], t.name);
  for (const t of tools) assert.deepEqual(Object.keys(t.outputSchema?.properties ?? {}), ["data"], t.name);
});

test("store_as + fetch_all lands in the Durable Object, across stateless requests", async () => {
  const { json, text } = await call("get_ohlcv", { ticker: "AAPL", store_as: "aapl", fetch_all: true });
  assert.equal(json?.row_count, 2500, text);
  assert.equal(json.pages, 3);
  const { structuredContent } = (await call("get_ohlcv", { ticker: "AAPL", store_as: "aapl", fetch_all: true })).result;
  assert.equal(structuredContent.data.row_count, 2500);
  assert.equal(structuredContent.data.sample.length, 5);
  const agg = await sql("SELECT count(*), min(date), max(date), count(DISTINCT ticker) FROM aapl");
  assert.deepEqual(agg.rows, [[2500, "2015-01-01", "2021-11-04", 1]]);
  const capped = await sql("SELECT date FROM aapl ORDER BY date");
  assert.equal(capped.rows.length, 200);
  assert.equal(capped.truncated, true);
  const csv = await sql("SELECT date, close FROM aapl ORDER BY date", { format: "csv", max_rows: 2 });
  assert.equal(csv.csv, "date,close\n2015-01-01,0.5\n2015-01-02,1.5");
  const desc = await sql("DESCRIBE aapl");
  assert.equal(Object.fromEntries(desc.columns).close, "real");
  const shown = await sql("SHOW TABLES");
  assert.deepEqual(shown.tables.map((t) => t.table), ["aapl"]);
});

test("query_data is read-only on the Durable Object too", async () => {
  for (const bad of [
    "DELETE FROM aapl",
    "DROP TABLE aapl",
    "SELECT 1; DELETE FROM aapl",
    "PRAGMA query_only = 0",
  ]) {
    const { result } = await call("query_data", { sql: bad });
    assert.equal(result.isError, true, bad);
  }
  // A WITH ... DELETE passes the prefix check; the rollback undoes it.
  await call("query_data", { sql: "WITH x AS (SELECT 1) DELETE FROM aapl" });
  await call("query_data", { sql: "WITH x AS (SELECT 1) UPDATE _tdb_tables SET rows = 0" });
  const still = await sql("SELECT count(*) FROM aapl");
  assert.equal(still.rows[0][0], 2500);
  assert.equal((await sql("SHOW TABLES")).tables[0].rows, 2500);
});

test("tables wider than 99 columns keep the rest in _extra; big inline results auto-store", async () => {
  const { json, text } = await call("query", { fields: ["f0"] });
  assert.equal(json?.stored, true, text);
  assert.match(json.note, /stored instead of returned/);
  assert.equal(json.row_count, 300);
  assert.equal(json.columns.length, 100);
  assert.equal(json.columns.at(-1), "_extra");
  assert.equal(json.extra_columns.length, 52);
  const r = await sql(`SELECT ticker, json_extract(_extra, '$.f120') FROM ${json.table} WHERE ticker = 'T7'`);
  assert.deepEqual(r.rows, [["T7", 7]]);
});

test("each API key has its own tables", async () => {
  const other = await sql("SHOW TABLES", {}, "tdb_someone_else");
  assert.deepEqual(other.tables, []);
  const { result, text } = await call("query_data", { sql: "SELECT count(*) FROM aapl" }, "tdb_someone_else");
  assert.equal(result.isError, true);
  assert.match(text, /no such table/);
});
