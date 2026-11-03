import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The site's schema (tickerdb.com, src/lib/db/schema) owns these tables. They live
// in a database shared with Oversold, so this copy must use the prefixed names too.
const source = readFileSync(new URL("../src/oauth/db.ts", import.meta.url), "utf8");

test("the MCP worker only names tickerdb_ tables and indexes", () => {
  const names = [...source.matchAll(/\b(?:pgTable|uniqueIndex|index)\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 7, "expected to find the table definitions");
  for (const name of names) assert.match(name, /^tickerdb_/);
});

test("the MCP worker reads the seven tables it needs", () => {
  for (const table of [
    "tickerdb_users",
    "tickerdb_api_keys",
    "tickerdb_oauth_clients",
    "tickerdb_oauth_authorization_codes",
    "tickerdb_oauth_access_tokens",
    "tickerdb_oauth_refresh_tokens",
    "tickerdb_oauth_mcp_keys",
  ]) {
    assert.ok(source.includes(`'${table}'`), table);
  }
});
