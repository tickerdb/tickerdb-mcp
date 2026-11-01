// The MCP server must always reflect the API (owner, 2026-11-01). When the
// website checkout sits beside this one (../tickerdb.com), every public /v1
// route has a tool, every tool calls a route that exists, and each tool's
// parameters are exactly the query parameters its route reads (minus the ones
// listed below with a reason). Skipped when the website checkout is absent.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const API = join(ROOT, "..", "tickerdb.com", "src", "pages", "api", "v1");
const TOOLS = join(ROOT, "shared", "src", "tools");

/** Routes that are not MCP tools, with the reason. */
const NOT_TOOLS = {
  "/bulk/manifest": "bulk Parquet downloads are files, not tool results",
  "/bulk/market": "bulk Parquet downloads are files, not tool results",
  "/bulk/snapshots": "bulk Parquet downloads are files, not tool results",
  "/team": "team seat management happens in the dashboard",
  "/stripe/webhook": "billing webhook, not a public endpoint",
};

/** Query parameters a route reads that its tool deliberately omits. */
const NOT_PARAMS = {
  "/summary/[ticker]": { offset: "the API only rejects it (not supported for date ranges)" },
  "/search": { sort_dir: "alias of sort_direction, which the tool exposes" },
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

function routeParams(route) {
  const source = readFileSync(join(API, `${route}.ts`), "utf8");
  return new Set([...source.matchAll(/(?:searchParams|params)\.(?:get|getAll|has)\('([a-z_]+)'\)/g)].map((m) => m[1]));
}

function tools() {
  return readdirSync(TOOLS)
    .filter((f) => /^(get|add|remove)-.*\.ts$/.test(f))
    .map((file) => {
      const source = readFileSync(join(TOOLS, file), "utf8");
      const name = source.match(/server\.tool\(\s*"([a-z_]+)"/)?.[1];
      const path = source.match(/callTickerDb\(\s*apiKey,\s*[`"](\/[a-z_/]+)/)?.[1];
      const schema = source.slice(source.indexOf("{", source.indexOf(`"${name}"`) + name.length + 2));
      const args = [...schema.slice(0, schema.indexOf("readOnlyHint")).matchAll(/^\s{6}([a-z_]+): z/gm)].map((m) => m[1]);
      return { file, name, path, args };
    });
}

function routeOf(path) {
  return path.replace(/^\/(summary|ohlcv)\/?$/, "/$1/[ticker]");
}

test("every public API route has an MCP tool, and every tool calls a route", { skip: !existsSync(API) }, () => {
  const all = routes(API);
  const used = new Set(tools().map((t) => routeOf(t.path)));
  for (const route of all) {
    if (route in NOT_TOOLS) continue;
    assert.ok(used.has(route), `API route /v1${route} has no MCP tool`);
  }
  for (const t of tools()) {
    assert.ok(t.path, `${t.file}: no callTickerDb path found`);
    assert.ok(all.includes(routeOf(t.path)), `${t.name} calls /v1${t.path}, which the API does not serve`);
  }
});

test("each tool's parameters are exactly its route's query parameters", { skip: !existsSync(API) }, () => {
  for (const t of tools()) {
    const route = routeOf(t.path);
    const expected = new Set([...routeParams(route)].filter((p) => !(p in (NOT_PARAMS[route] ?? {}))));
    const actual = new Set(t.args.filter((a) => !(PATH_ARGS[route] ?? []).includes(a)));
    assert.deepEqual([...actual].sort(), [...expected].sort(), `${t.name} parameters differ from /v1${route}`);
  }
});
