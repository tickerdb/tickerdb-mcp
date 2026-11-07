// The MCP server must always reflect the API (owner, 2026-11-01; hybrid design
// 2026-11-06). Against a website checkout, this checks that:
//   - every public /v1 route is reachable, through a first-class tool or call_tool;
//   - every tool and call_tool endpoint calls a route the API serves;
//   - each first-class tool's parameters are exactly its route's query parameters
//     (for `query`: the union across /search, /universe and /history), and each
//     call_tool endpoint's parameters are exactly its route's, minus NOT_PARAMS;
//   - what each tool actually sends is a subset of what its route accepts.
// A route's parameters are the allowlist it passes to unknownParamsError (the API
// rejects anything else), falling back to the searchParams.get calls it makes.
//
// Website checkout: TICKERDB_WEBSITE_DIR (its root), default ../tickerdb.com beside
// this repo. Launch is checked against the website branch launch-api:
//   TICKERDB_WEBSITE_DIR=../web-launch npm test
// Skipped when the checkout is absent.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEBSITE = resolve(ROOT, process.env.TICKERDB_WEBSITE_DIR ?? join("..", "tickerdb.com"));
const API = join(WEBSITE, "src", "pages", "api", "v1");
const skip = existsSync(API) ? false : `no website checkout at ${WEBSITE}`;

/** Routes that are not reachable from MCP, with the reason. */
const NOT_TOOLS = {
  "/stripe/webhook": "billing webhook, not a public endpoint",
};

/** Query parameters a route reads that the MCP deliberately omits, with the reason. */
const NOT_PARAMS = {
  "/summary/[ticker]": { offset: "the route only rejects it (offset is not supported for summary date ranges)" },
  "/search": { sort_dir: "alias of sort_direction, which is exposed" },
};

/** Tool arguments that are path segments, not query parameters. */
const PATH_ARGS = { "/summary/[ticker]": ["ticker"], "/ohlcv/[ticker]": ["ticker"] };

function routes(dir, prefix = "") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path, `${prefix}/${name}`);
    return name.endsWith(".ts") ? [`${prefix}/${name.replace(/\.ts$/, "")}`] : [];
  });
}

/** The balanced [...] or {...} expression starting at source[i]. */
function balanced(source, i) {
  const open = source[i];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    if (source[j] === open) depth++;
    else if (source[j] === close && --depth === 0) return source.slice(i, j + 1);
  }
  throw new Error(`unbalanced ${open} at ${i}`);
}

const quoted = (s) => [...s.matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)].map((m) => m[1] ?? m[2]);

/** String values of a const array/object declared in this file or imported into it. */
function constStrings(file, ident, seen = new Set()) {
  if (seen.has(`${file}#${ident}`)) return undefined;
  seen.add(`${file}#${ident}`);
  const source = readFileSync(file, "utf8");
  const decl = new RegExp(`(?:const|let)\\s+${ident}\\b[^=]*=\\s*([\\[{])`).exec(source);
  if (decl) return quoted(balanced(source, decl.index + decl[0].length - 1));
  const imp = new RegExp(`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`).exec(source);
  if (imp && imp[1].startsWith(".")) {
    const target = resolve(dirname(file), imp[1]);
    for (const f of [`${target}.ts`, join(target, "index.ts"), target]) {
      if (existsSync(f) && statSync(f).isFile()) return constStrings(f, ident, seen);
    }
  }
  return undefined;
}

function routeParams(route) {
  const file = join(API, `${route}.ts`);
  const source = readFileSync(file, "utf8");
  const out = new Set();
  let found = false;
  for (const m of source.matchAll(/unknownParamsError\(\s*[\w.]+\s*,\s*/g)) {
    found = true;
    const at = m.index + m[0].length;
    if (source[at] === "[") {
      quoted(balanced(source, at)).forEach((p) => out.add(p));
    } else {
      const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at))[0];
      const values = constStrings(file, ident);
      assert.ok(values, `${route}: cannot resolve the parameter list ${ident}`);
      values.forEach((p) => out.add(p));
    }
  }
  if (!found) {
    for (const m of source.matchAll(/(?:searchParams|params)\.(?:get|getAll|has)\('([a-z_]+)'\)/g)) out.add(m[1]);
  }
  return out;
}

const expectedParams = (route) => new Set([...routeParams(route)].filter((p) => !(p in (NOT_PARAMS[route] ?? {}))));
const sorted = (s) => [...s].sort();

/** Compiles shared/src (TypeScript) into one module this test can import. */
async function loadShared() {
  const dir = mkdtempSync(join(tmpdir(), "tickerdb-mcp-parity-"));
  const outfile = join(dir, "shared.mjs");
  await build({
    entryPoints: [join(ROOT, "shared", "src", "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let shared;
let tools;

test.before(async () => {
  if (skip) return;
  shared = await loadShared();
  const server = shared.createTickerDbServer("tdb_parity");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  tools = (await client.listTools()).tools;
  await client.close();
});

/** Long-tail endpoints: call_tool names with their route. */
const longTail = () => Object.values(shared.OPS).filter((op) => op.params);

/** A value of the right kind for every declared param. */
function sampleArgs(params) {
  const sample = (type) =>
    type === "integer" ? 1 : type === "boolean" ? true : type === "string[]" ? ["AAPL"] : type.startsWith("YYYY") ? "2024-01-02" : type.includes("|") ? type.split("|")[0] : "x";
  return Object.fromEntries(Object.entries(params).map(([k, s]) => [k, sample(s.type)]));
}

const sentKeys = (req) => new Set(Object.entries(req.query).filter(([, v]) => v !== undefined).map(([k]) => k));

test("every public API route is reachable, and every tool calls a route the API serves", { skip }, () => {
  const all = routes(API);
  const reachable = new Map();
  for (const [tool, rs] of Object.entries(shared.FIRST_CLASS_ROUTES)) for (const r of rs) reachable.set(r, tool);
  for (const op of longTail()) {
    assert.ok(op.apiRoute, `${op.name}: no apiRoute`);
    reachable.set(op.apiRoute, `call_tool ${op.name}`);
  }
  for (const route of all) {
    if (route in NOT_TOOLS) continue;
    assert.ok(reachable.has(route), `API route /v1${route} is not reachable from MCP (no first-class tool, no call_tool endpoint)`);
  }
  for (const [route, via] of reachable) {
    assert.ok(all.includes(route), `${via} calls /v1${route}, which the API does not serve`);
  }
  const names = tools.map((t) => t.name);
  for (const tool of Object.keys(shared.FIRST_CLASS_ROUTES)) assert.ok(names.includes(tool), `${tool} is not served`);
});

test("each first-class tool's parameters are exactly its route's (query: the union of its three)", { skip }, () => {
  for (const [name, rs] of Object.entries(shared.FIRST_CLASS_ROUTES)) {
    const tool = tools.find((t) => t.name === name);
    const pathArgs = rs.flatMap((r) => PATH_ARGS[r] ?? []);
    const actual = Object.keys(tool.inputSchema.properties ?? {}).filter((a) => !shared.MCP_ONLY_PARAMS.includes(a) && !pathArgs.includes(a));
    const expected = new Set(rs.flatMap((r) => [...expectedParams(r)]));
    assert.deepEqual(sorted(actual), sorted(expected), `${name} parameters differ from /v1${rs.join(" + /v1")}`);
  }
});

test("each call_tool endpoint's parameters are exactly its route's", { skip }, () => {
  for (const op of longTail()) {
    const expected = expectedParams(op.apiRoute);
    const declared = Object.keys(op.params).filter((a) => !(PATH_ARGS[op.apiRoute] ?? []).includes(a));
    assert.deepEqual(sorted(declared), sorted(expected), `call_tool ${op.name} parameters differ from /v1${op.apiRoute}`);
    const req = op.request(sampleArgs(op.params));
    assert.deepEqual(sorted(sentKeys(req)), sorted(expected), `call_tool ${op.name} does not send every parameter it declares`);
  }
});

test("what each first-class tool sends is accepted by its route", { skip }, () => {
  const pathOf = (route) => route.replace("[ticker]", "AAPL");
  for (const name of ["get_schema", "get_summary", "get_market", "get_ohlcv"]) {
    const [route] = shared.FIRST_CLASS_ROUTES[name];
    const tool = tools.find((t) => t.name === name);
    const args = Object.fromEntries(Object.keys(tool.inputSchema.properties).map((k) => [k, k === "ticker" ? "AAPL" : "1"]));
    const req = shared.OPS[name].request(args);
    assert.equal(req.path, pathOf(route), `${name} path`);
    const allowed = routeParams(route);
    for (const k of sentKeys(req)) assert.ok(allowed.has(k), `${name} sends ${k}, which /v1${route} rejects`);
    const unsent = [...expectedParams(route)].filter((k) => !sentKeys(req).has(k));
    assert.deepEqual(unsent, [], `${name} never sends ${unsent.join(", ")}`);
  }

  // query: every mode, with every parameter that mode takes.
  const modes = [
    { route: "/search", args: { fields: ["a"], filters: [{ field: "a", op: "eq", value: 1 }], date: "2024-01-02", sort_by: "a", sort_direction: "asc", limit: 5, offset: 5, timeframe: "daily", member_of: "sp500", held_by: "SPY", tickers: ["AAPL"], asset_class: "stock" } },
    { route: "/search", args: { fields: ["a"], filters: [{ field: "market_regime_zone", op: "eq", value: "x" }], start: "2024-01-02", end: "2024-02-02", sort_by: "a", sort_direction: "asc", limit: 5, offset: 5, timeframe: "daily", member_of: "sp500", held_by: "SPY" } },
    { route: "/universe", args: { fields: ["a"], date: "2024-01-02", timeframe: "daily", asset_class: "stock", member_of: "sp500", held_by: "SPY" } },
    { route: "/history", args: { fields: ["a"], tickers: ["AAPL"], start: "2020-01-02", end: "2024-01-02", timeframe: "weekly", asset_class: "stock", member_of: "sp500", held_by: "SPY", ohlcv: true, adjustment: "raw", limit: 10, page_token: "t", dry_run: true } },
  ];
  const covered = new Set();
  for (const { route, args } of modes) {
    const { op, args: resolved } = shared.QUERY_OP.resolve(args);
    const req = op.request(resolved);
    assert.equal(req.path, route, `query ${JSON.stringify(args)} routes to ${req.path}`);
    const allowed = routeParams(route);
    for (const k of sentKeys(req)) {
      assert.ok(allowed.has(k), `query sends ${k} to /v1${route}, which rejects it`);
      covered.add(`${route}:${k}`);
    }
  }
  for (const route of shared.FIRST_CLASS_ROUTES.query) {
    for (const k of expectedParams(route)) assert.ok(covered.has(`${route}:${k}`), `query never sends ${k} to /v1${route}`);
  }
});
