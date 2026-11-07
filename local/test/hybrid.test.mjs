// The stdio server (dist/index.js) against a stub TickerDB API: store_as/query_data,
// fetch_all paging, search_tools and call_tool.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const BAR_COUNT = 2500;
const TRADE_COUNT = 250;
const UNIVERSE_ROWS = 3000;
const requests = [];

function day(i) {
  const d = new Date(Date.UTC(2015, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
}
const ALL_BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({ date: day(i), open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1000 + i }));
const MARKET_ROWS = Array.from({ length: 450 }, (_, i) => ({ date: day(i), market_regime_zone: i % 2 ? "bull_broad" : "correction", macro_yield_curve_10y_minus_2y_pct: i / 100 }));

function handle(url, res) {
  const p = url.searchParams;
  const send = (body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const limit = (d, max) => Math.min(Number(p.get("limit") ?? d), max);
  const path = url.pathname.replace(/^\/v1/, "");

  if (path === "/ohlcv/AAPL") {
    const n = limit(100, 1000);
    const cursor = p.get("cursor");
    const desc = (p.get("order") ?? "desc") === "desc";
    let bars = desc ? [...ALL_BARS].reverse() : ALL_BARS;
    if (cursor) bars = bars.filter((b) => (desc ? b.date < cursor : b.date > cursor));
    const page = bars.slice(0, n);
    const hasMore = bars.length > n;
    return send({ ticker: "AAPL", timeframe: "daily", row_count: page.length, has_more: hasMore, next_cursor: hasMore ? page.at(-1).date : null, bars: page });
  }
  if (path === "/insiders/trades") {
    const n = limit(100, 1000);
    const offset = Number(p.get("offset") ?? 0);
    const all = Array.from({ length: TRADE_COUNT }, (_, i) => ({ disclosed_at: day(i), ticker: "AMZN", side: i % 3 ? "S" : "P", shares: i, planned: i % 2 === 0 }));
    const page = all.slice(offset, offset + n);
    return send({ insider: { slug: p.get("insider"), name: "Test Person" }, limit: n, offset, has_more: offset + n < all.length, row_count: page.length, trades: page });
  }
  if (path === "/insiders") {
    return send({ limit: 20, offset: 0, has_more: false, row_count: 1, insiders: [{ slug: "jeffrey-p-bezos", name: "Bezos Jeffrey P", companies: [{ ticker: "AMZN" }] }] });
  }
  if (path === "/changes") {
    const tickers = (p.get("tickers") ?? "").split(",");
    const changes = Object.fromEntries(tickers.map((t) => [t, [{ field: "momentum_rsi_zone", from: "neutral", to: "oversold" }, { field: "trend_direction", from: "up", to: "flat" }]]));
    return send({ timeframe: "daily", run_date: "2026-11-05", changes, tickers_checked: tickers.length, tickers_changed: tickers.length });
  }
  if (path === "/universe") {
    const rows = Array.from({ length: UNIVERSE_ROWS }, (_, i) => ({ ticker: `T${String(i).padStart(5, "0")}`, momentum_rsi_zone: i % 5 === 0 ? "oversold" : "neutral", market_cap_usd: i * 1e6, trend: { direction: "up" }, flag: i % 2 === 0 }));
    return send({ date: "2026-11-05", timeframe: "daily", row_count: rows.length, rows });
  }
  if (path === "/market") {
    const n = limit(100, 2000);
    const start = p.get("start") ?? "0000";
    const end = p.get("end") ?? "9999";
    const asc = p.get("order") === "asc";
    let rows = MARKET_ROWS.filter((r) => r.date >= start && r.date <= end);
    if (!asc) rows = rows.reverse();
    rows = rows.slice(0, n);
    return send({ timeframe: "daily", date_mode: "range", start, end, row_count: rows.length, rows });
  }
  if (path === "/search") {
    const n = limit(20, 500);
    const offset = Number(p.get("offset") ?? 0);
    const total = 1200;
    const results = Array.from({ length: Math.max(0, Math.min(n, total - offset)) }, (_, i) => ({ ticker: `S${offset + i}`, market_cap_usd: offset + i }));
    return send({ timeframe: p.get("timeframe") ?? "daily", date: p.get("date"), result_count: results.length, results });
  }
  if (path === "/history") {
    // Three planned pages of whole assets; the middle one continues itself once.
    // Tokens carry the parameters they were issued for, as the real signed ones do.
    const tok = p.get("page_token");
    const key = JSON.stringify(Object.fromEntries([...p].filter(([k]) => k !== "page_token")));
    if (tok && tok.split("|")[1] !== key) return send({ error: { message: "page_token was issued for other parameters" } }, 400);
    const at = (t, dateIdx) => ({ ticker: t, date: day(dateIdx), momentum_rsi_zone: dateIdx % 4 === 0 ? "oversold" : "neutral", fundamentals_pe_ratio: dateIdx });
    const block = (t) => Array.from({ length: 10 }, (_, i) => at(t, i * 7));
    const pages = { first: block("AAA"), p2: block("BBB").slice(0, 5), p2b: block("BBB").slice(5), p3: block("CCC") };
    const name = tok ? tok.split("|")[0] : "first";
    const rows = pages[name];
    return send({
      timeframe: p.get("timeframe"), start: p.get("start"), end: p.get("end"),
      ...(tok ? {} : { pages: 3, page_tokens: [`p2|${key}`, `p3|${key}`] }),
      row_count: rows.length, has_more: name === "p2", next_page_token: name === "p2" ? `p2b|${key}` : null, rows,
    });
  }
  if (path === "/insiders/holdings") {
    return send({ insider: { slug: p.get("insider") }, source: p.get("source") ?? "13f", basis: "filed_holdings", limit: 100, offset: 0, has_more: false, row_count: 2, holdings: [{ ticker: "AAPL", value_usd: 2 }, { ticker: "KO", value_usd: 1 }] });
  }
  if (path === "/status") return send({ daily: { stock: "2026-11-05" } });
  return send({ error: { message: `stub: no route ${path}` } }, 404);
}

const stub = createServer((req, res) => {
  const url = new URL(req.url, "http://stub");
  requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
  handle(url, res);
});

let client;
let tmp;

test.before(async () => {
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const { port } = stub.address();
  tmp = mkdtempSync(join(tmpdir(), "hybrid-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/cli.js"],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...getDefaultEnvironment(), TICKERDB_KEY: "tdb_test", TICKERDB_API_BASE: `http://127.0.0.1:${port}/v1` },
    stderr: "pipe",
  });
  client = new Client({ name: "hybrid-test", version: "1.0.0" });
  await client.connect(transport);
});

test.after(async () => {
  await client?.close();
  stub.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { result, text, json };
}

async function sql(query, extra = {}) {
  const { result, json, text } = await call("query_data", { sql: query, ...extra });
  assert.notEqual(result.isError, true, text);
  return json;
}

test("lists the tools with short descriptions and instructions", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "call_tool", "get_market", "get_ohlcv", "get_schema", "get_summary", "query", "query_data", "search_tools",
  ]);
  for (const t of tools) assert.ok(t.description.length < 600, `${t.name}: ${t.description.length} chars`);
  assert.ok(client.getInstructions().length < 1000);
});

test("get_ohlcv store_as + fetch_all follows the cursor into one table", async () => {
  const { json } = await call("get_ohlcv", { ticker: "aapl", timeframe: "daily", store_as: "aapl", fetch_all: true });
  assert.equal(json.stored, true);
  assert.equal(json.table, "aapl");
  assert.equal(json.row_count, BAR_COUNT);
  assert.equal(json.pages, 3);
  assert.equal(json.sample.length, 5);
  assert.ok(json.columns.includes("ticker"), "ticker hoisted onto bars");
  const pages = requests.filter((r) => r.path === "/v1/ohlcv/AAPL");
  assert.equal(pages.length, 3);
  assert.equal(pages[0].query.limit, "1000");
  assert.equal(pages[0].query.cursor, undefined);
  assert.equal(pages[1].query.cursor, day(BAR_COUNT - 1000));
  assert.equal(pages[0].auth, "Bearer tdb_test");

  const agg = await sql("SELECT count(*) AS n, min(date) AS first, max(date) AS last, count(DISTINCT ticker) AS t FROM aapl");
  assert.deepEqual(agg.rows, [[BAR_COUNT, day(0), day(BAR_COUNT - 1), 1]]);
});

test("query_data caps rows, writes CSV, and lists/describes tables", async () => {
  const capped = await sql("SELECT date, close FROM aapl ORDER BY date");
  assert.equal(capped.rows.length, 200);
  assert.equal(capped.row_count, BAR_COUNT);
  assert.equal(capped.truncated, true);

  const small = await sql("SELECT date FROM aapl ORDER BY date", { max_rows: 3 });
  assert.equal(small.rows.length, 3);

  const csvPath = join(tmp, "out", "bars.csv");
  const written = await sql("SELECT date, close FROM aapl ORDER BY date", { output_path: csvPath });
  assert.equal(written.csv_file, csvPath);
  const lines = readFileSync(csvPath, "utf8").trim().split("\n");
  assert.equal(lines.length, BAR_COUNT + 1);
  assert.equal(lines[0], "date,close");

  const inlineCsv = await sql("SELECT date, close FROM aapl ORDER BY date", { format: "csv", max_rows: 2 });
  assert.equal(inlineCsv.csv, `date,close
${day(0)},0.5
${day(1)},1.5`);
  assert.equal(inlineCsv.truncated, true);
  assert.equal(inlineCsv.rows, undefined);

  const tables = await sql("SHOW TABLES");
  const aapl = tables.tables.find((t) => t.table === "aapl");
  assert.equal(aapl.rows, BAR_COUNT);

  const desc = await sql("DESCRIBE aapl");
  assert.deepEqual(Object.fromEntries(desc.columns).close, "real");
  assert.deepEqual(Object.fromEntries(desc.columns).date, "text");

  const cte = await sql("WITH x AS (SELECT close FROM aapl) SELECT round(avg(close), 1) FROM x");
  assert.equal(cte.rows[0][0], (BAR_COUNT - 1) / 2 + 0.5);
});

test("query_data is read-only", async () => {
  for (const bad of [
    "DELETE FROM aapl",
    "DROP TABLE aapl",
    "INSERT INTO aapl (date) VALUES ('x')",
    "SELECT 1; DELETE FROM aapl",
    "ATTACH DATABASE 'x.db' AS x",
    "PRAGMA query_only = 0",
  ]) {
    const { result } = await call("query_data", { sql: bad });
    assert.equal(result.isError, true, bad);
  }
  const still = await sql("SELECT count(*) FROM aapl");
  assert.equal(still.rows[0][0], BAR_COUNT);
});

test("search_tools finds long-tail endpoints with params", async () => {
  const { text } = await call("search_tools", { query: "insider trades" });
  assert.match(text.split("\n")[0], /^get_insider_trades:/);
  assert.match(text, /insider\*: string/);

  const all = (await call("search_tools", {})).text;
  for (const name of ["get_changes", "get_insiders", "get_insider_trades", "get_insider_holdings", "get_funds", "get_fund_holdings", "get_fund_holders", "get_indexes", "get_index_members", "get_status", "get_account"]) {
    assert.match(all, new RegExp(`^${name}:`, "m"));
  }
  assert.doesNotMatch(all, /^get_ohlcv:/m);

  const none = (await call("search_tools", { query: "zzzz" })).text;
  assert.match(none, /No match/);
});

test("call_tool runs an endpoint inline", async () => {
  const { json } = await call("call_tool", { name: "get_insiders", params: { q: "jeff bezos" } });
  assert.equal(json.insiders[0].slug, "jeffrey-p-bezos");
  assert.equal(requests.at(-1).query.q, "jeff bezos");

  const status = await call("call_tool", { name: "get_status" });
  assert.equal(status.json.daily.stock, "2026-11-05");
});

test("call_tool validates name and params", async () => {
  const unknownTool = await call("call_tool", { name: "get_nope", params: {} });
  assert.equal(unknownTool.result.isError, true);
  assert.match(unknownTool.text, /search_tools/);

  const firstClass = await call("call_tool", { name: "get_ohlcv", params: { ticker: "AAPL" } });
  assert.equal(firstClass.result.isError, true);
  assert.match(firstClass.text, /first-class/);

  const badParam = await call("call_tool", { name: "get_insider_trades", params: { insider: "x", bogus: 1 } });
  assert.equal(badParam.result.isError, true);
  assert.match(badParam.text, /unknown param\(s\) bogus/);

  const missing = await call("call_tool", { name: "get_insider_trades", params: {} });
  assert.equal(missing.result.isError, true);
  assert.match(missing.text, /insider is required/);

  const badEnum = await call("call_tool", { name: "get_insiders", params: { type: "robot" } });
  assert.equal(badEnum.result.isError, true);
});

test("call_tool fetch_all follows offset paging into a table", async () => {
  const before = requests.length;
  const { json } = await call("call_tool", {
    name: "get_insider_trades",
    params: { insider: "Jeffrey-P-Bezos", open_market_only: true },
    store_as: "trades",
    fetch_all: true,
  });
  assert.equal(json.row_count, TRADE_COUNT);
  const pages = requests.slice(before);
  assert.deepEqual(pages.map((r) => r.query.offset), ["0"]);
  assert.equal(pages[0].query.insider, "jeffrey-p-bezos");
  assert.equal(pages[0].query.open_market_only, "true");

  const bySide = await sql("SELECT side, count(*) FROM trades GROUP BY side ORDER BY side");
  assert.deepEqual(bySide.rows, [["P", 84], ["S", 166]]);
  const insider = await sql("SELECT DISTINCT insider FROM trades");
  assert.deepEqual(insider.rows, [["jeffrey-p-bezos"]]);
});

test("offset paging takes several pages when limit is small", async () => {
  const before = requests.length;
  const { json } = await call("call_tool", { name: "get_insider_trades", params: { insider: "x", limit: 100 }, store_as: "trades_small", fetch_all: true });
  assert.equal(json.row_count, TRADE_COUNT);
  assert.equal(json.pages, 3);
  assert.deepEqual(requests.slice(before).map((r) => r.query.offset), ["0", "100", "200"]);
});

test("call_tool get_changes stores one row per ticker and change", async () => {
  const { json } = await call("call_tool", { name: "get_changes", params: { tickers: ["aapl", "msft"] }, store_as: "chg" });
  assert.equal(json.row_count, 4);
  assert.equal(requests.at(-1).query.tickers, "AAPL,MSFT");
  const r = await sql("SELECT ticker, \"to\" FROM chg WHERE field = 'momentum_rsi_zone' ORDER BY ticker");
  assert.deepEqual(r.rows, [["AAPL", "oversold"], ["MSFT", "oversold"]]);
});

test("store_as flattens nested fields, append adds rows", async () => {
  const { json } = await call("query", { fields: ["momentum_rsi_zone"], store_as: "uni" });
  assert.equal(json.row_count, UNIVERSE_ROWS);
  assert.ok(json.columns.includes("trend_direction"));
  assert.equal(json.response.date, "2026-11-05");
  const oversold = await sql("SELECT count(*) FROM uni WHERE momentum_rsi_zone = 'oversold' AND flag = 1");
  assert.equal(oversold.rows[0][0], UNIVERSE_ROWS / 10);

  const again = await call("query", { fields: ["momentum_rsi_zone"], store_as: "uni", append: true });
  assert.equal(again.json.row_count, UNIVERSE_ROWS * 2);
  const replaced = await call("query", { fields: ["momentum_rsi_zone"], store_as: "uni" });
  assert.equal(replaced.json.row_count, UNIVERSE_ROWS);
});

test("large inline results are stored automatically", async () => {
  const { json } = await call("query", { fields: ["momentum_rsi_zone"] });
  assert.equal(json.stored, true);
  assert.match(json.note, /stored instead of returned/);
  assert.equal(json.row_count, UNIVERSE_ROWS);
});

test("get_market fetch_all pages a date range by moving its edge", async () => {
  const before = requests.length;
  const { json } = await call("get_market", { start: day(0), end: day(449), limit: 200, store_as: "mkt", fetch_all: true });
  assert.equal(json.row_count, 450);
  assert.equal(json.pages, 3);
  const ends = requests.slice(before).map((r) => r.query.end);
  assert.deepEqual(ends, [day(449), day(249), day(49)]);
  const dupes = await sql("SELECT count(*) - count(DISTINCT date) FROM mkt");
  assert.equal(dupes.rows[0][0], 0);
});

test("store_as rejects unsafe table names", async () => {
  const { result, text } = await call("get_ohlcv", { ticker: "AAPL", store_as: "x; drop" });
  assert.equal(result.isError, true);
  assert.match(text, /plain table name/);
});

// ---- query routing ----

function lastRequest(path) {
  return requests.filter((r) => r.path === `/v1${path}`).at(-1);
}

test("query: one date with filters -> /v1/search (filters forwarded, asset_class becomes a filter)", async () => {
  const filters = [{ field: "momentum_rsi_zone", op: "in", value: ["oversold"] }];
  const { json } = await call("query", { date: "2026-10-30", fields: ["market_cap_usd"], filters, asset_class: "stock", sort_by: "market_cap_usd", limit: 50 });
  assert.equal(json.route, "/v1/search");
  const r = lastRequest("/search");
  assert.deepEqual(JSON.parse(r.query.filters), [...filters, { field: "asset_class", op: "eq", value: "stock" }]);
  assert.deepEqual(JSON.parse(r.query.fields), ["market_cap_usd"]);
  assert.equal(r.query.date, "2026-10-30");
  assert.equal(r.query.sort_by, "market_cap_usd");
  assert.equal(r.query.limit, "50");
});

test("query: a limit or tickers without filters still goes to /v1/search", async () => {
  await call("query", { fields: ["market_cap_usd"], sort_by: "market_cap_usd", limit: 10 });
  assert.deepEqual(JSON.parse(lastRequest("/search").query.filters), [{ field: "ticker", op: "neq", value: "" }]);

  await call("query", { fields: ["market_cap_usd"], tickers: ["aapl", "msft"] });
  const r = lastRequest("/search");
  assert.deepEqual(JSON.parse(r.query.filters), [{ field: "ticker", op: "in", value: ["AAPL", "MSFT"] }]);
  assert.equal(r.query.limit, "2");
});

test("query: one date, no filters -> /v1/universe", async () => {
  const before = requests.length;
  const { json } = await call("query", { fields: ["momentum_rsi_zone"], date: "2026-10-30", asset_class: "etf", member_of: "sp500", store_as: "u1" });
  assert.equal(json.route, "/v1/universe");
  const sent = requests.slice(before);
  assert.deepEqual(sent.map((r) => r.path), ["/v1/universe"]);
  assert.equal(sent[0].query.asset_class, "etf");
  assert.equal(sent[0].query.member_of, "sp500");
  assert.equal(sent[0].query.date, "2026-10-30");
});

test("query: fetch_all on a one-date screen pages /v1/search by offset", async () => {
  const before = requests.length;
  const { json } = await call("query", { filters: [{ field: "market_cap_usd", op: "gt", value: 0 }], store_as: "screen", fetch_all: true });
  assert.equal(json.row_count, 1200);
  assert.deepEqual(requests.slice(before).map((r) => r.query.offset), [undefined, "500", "1000"]);
});

test("query: a range -> /v1/history, fetch_all follows page_tokens and next_page_token", async () => {
  const before = requests.length;
  const { json } = await call("query", { fields: ["momentum_rsi_zone"], start: "2019-01-01", end: "2025-12-31", store_as: "hist", fetch_all: true });
  assert.equal(json.route, "/v1/history");
  assert.equal(json.row_count, 30);
  assert.equal(json.pages, 4);
  const sent = requests.slice(before);
  assert.ok(sent.every((r) => r.path === "/v1/history"));
  assert.deepEqual(sent.map((r) => r.query.page_token?.split("|")[0]), [undefined, "p2", "p2b", "p3"]);
  assert.equal(sent[0].query.timeframe, "weekly", "ranges over ~6 months default to weekly");
  const per = await sql("SELECT ticker, count(*) FROM hist GROUP BY ticker ORDER BY ticker");
  assert.deepEqual(per.rows, [["AAA", 10], ["BBB", 10], ["CCC", 10]]);
});

test("query: short ranges keep the plan's timeframe; explicit timeframe wins", async () => {
  await call("query", { fields: ["momentum_rsi_zone"], start: "2025-01-01", end: "2025-03-31" });
  assert.equal(lastRequest("/history").query.timeframe, undefined);
  await call("query", { fields: ["momentum_rsi_zone"], start: "2019-01-01", end: "2025-12-31", timeframe: "daily" });
  assert.equal(lastRequest("/history").query.timeframe, "daily");
});

test("query: ticker filters on a range are applied by the server, per page", async () => {
  const { json } = await call("query", {
    fields: ["fundamentals_pe_ratio"],
    filters: [{ field: "momentum_rsi_zone", op: "eq", value: "oversold" }],
    start: "2019-01-01", end: "2025-12-31", store_as: "hist_f", fetch_all: true,
  });
  assert.equal(json.row_count, 9, "dates 0, 28, 56 for each of three assets");
  assert.deepEqual(JSON.parse(lastRequest("/history").query.fields), ["fundamentals_pe_ratio", "momentum_rsi_zone"]);
  const zones = await sql("SELECT DISTINCT momentum_rsi_zone FROM hist_f");
  assert.deepEqual(zones.rows, [["oversold"]]);

  const inline = await call("query", { fields: ["fundamentals_pe_ratio"], filters: [{ field: "fundamentals_pe_ratio", op: "gte", value: 50 }], start: "2019-01-01", end: "2025-12-31" });
  assert.deepEqual(inline.json.rows.map((r) => r.fundamentals_pe_ratio), [56, 63]);
  assert.equal(inline.json.route, "/v1/history");
});

test("query: a range with a market filter -> /v1/search with start/end", async () => {
  const { json } = await call("query", {
    fields: ["ticker"], filters: [{ field: "market_breadth_ma200_zone", op: "eq", value: "washed_out" }],
    tickers: ["aapl"], start: "2020-01-01", end: "2020-12-31",
  });
  assert.equal(json.route, "/v1/search");
  const r = lastRequest("/search");
  assert.equal(r.query.start, "2020-01-01");
  assert.equal(r.query.end, "2020-12-31");
  assert.equal(r.query.timeframe, "weekly");
  assert.deepEqual(JSON.parse(r.query.filters).at(-1), { field: "ticker", op: "in", value: ["AAPL"] });
});

test("query: rejects mixed or incomplete date input", async () => {
  for (const [args, re] of [
    [{ fields: ["x"], date: "2025-01-01", start: "2024-01-01", end: "2025-01-01" }, /either date/],
    [{ fields: ["x"], start: "2024-01-01" }, /both start and end/],
    [{ start: "2024-01-01", end: "2025-01-01" }, /needs fields/],
    [{ fields: ["x"], start: "2024-01-01", end: "2025-01-01", sort_by: "x" }, /sort_by works on one date/],
    [{}, /needs fields/],
  ]) {
    const { result, text } = await call("query", args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text, re);
  }
});

test("raw search and universe stay reachable through call_tool", async () => {
  const { text } = await call("search_tools", { query: "universe" });
  assert.match(text, /^get_universe:/);
  const { json } = await call("call_tool", { name: "get_search", params: { filters: [{ field: "ticker", op: "eq", value: "AAPL" }], limit: 3 } });
  assert.equal(json.result_count, 3);
  assert.deepEqual(JSON.parse(lastRequest("/search").query.filters), [{ field: "ticker", op: "eq", value: "AAPL" }]);
});

test("query: offset pages a one-date screen; page_token and dry_run go to /v1/history", async () => {
  await call("query", { fields: ["market_cap_usd"], sort_by: "market_cap_usd", limit: 20, offset: 40 });
  assert.equal(lastRequest("/search").query.offset, "40");

  await call("query", { fields: ["momentum_rsi_zone"], start: "2019-01-01", end: "2025-12-31", page_token: `p3|x`, dry_run: false });
  const h = lastRequest("/history");
  assert.equal(h.query.page_token, "p3|x");
  assert.equal(h.query.dry_run, "false");

  for (const [args, re] of [
    [{ fields: ["x"], dry_run: true }, /apply to ranges/],
    [{ fields: ["x"], start: "2024-01-01", end: "2025-01-01", offset: 10 }, /offset pages one-date/],
  ]) {
    const { result, text } = await call("query", args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(text, re);
  }
});

test("a stored first page says when more pages exist", async () => {
  const { json } = await call("query", { fields: ["momentum_rsi_zone"], start: "2019-01-01", end: "2025-12-31", store_as: "hist_one" });
  assert.equal(json.pages, 1);
  assert.match(json.more_pages, /fetch_all=true/);
});

test("call_tool get_insider_holdings (launch route) with its params", async () => {
  const { text } = await call("search_tools", { query: "insider holdings" });
  assert.match(text.split("\n")[0], /^get_insider_holdings:/);
  const { json } = await call("call_tool", { name: "get_insider_holdings", params: { insider: "Berkshire-Hathaway-Inc", source: "13f", include_closed: true }, store_as: "brk" });
  assert.equal(json.row_count, 2);
  const r = lastRequest("/insiders/holdings");
  assert.equal(r.query.insider, "berkshire-hathaway-inc");
  assert.equal(r.query.include_closed, "true");
  const ins = await sql("SELECT DISTINCT insider FROM brk");
  assert.deepEqual(ins.rows, [["berkshire-hathaway-inc"]]);
});
