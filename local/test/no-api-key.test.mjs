// The stdio server with no key, a bad key, or a key found in .env / the user config file.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedTools = [
  "call_tool",
  "get_market",
  "get_ohlcv",
  "get_schema",
  "get_summary",
  "query",
  "query_data",
  "search_tools",
];
const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

// Empty home, config dirs and working directory, so the developer's own key is never found.
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "tickerdb-mcp-key-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const dirs = {
    home: join(root, "home"),
    config: join(root, "config"),
    appData: join(root, "appdata"),
    cwd: join(root, "project"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    XDG_CONFIG_HOME: dirs.config,
    APPDATA: dirs.appData,
  };
  if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  const configFile =
    process.platform === "win32"
      ? join(dirs.appData, "tickerdb", "config.json")
      : join(dirs.config, "tickerdb", "config.json");
  return { dirs, env, configFile };
}

async function callAccount(env, cwd, expectedError) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], cwd, env, stderr: "pipe" });
  const client = new Client({ name: "no-key-smoke", version: "1.0.0" });
  // Closed here, not in t.after: the sandbox cleanup (registered first) needs the child gone.
  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).sort(), expectedTools);

    const result = await client.callTool({ name: "call_tool", arguments: { name: "get_account" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, expectedError);
    return result.content[0].text;
  } finally {
    await client.close();
  }
}

test("starts and exposes tools with no key anywhere; calls point to /setup", async (t) => {
  const { dirs, env } = sandbox(t);
  const text = await callAccount(env, dirs.cwd, /No TickerDB API key found/);
  assert.match(text, /https:\/\/tickerdb\.com\/setup/);
});

test("starts and exposes tools with a malformed TICKERDB_API_KEY", async (t) => {
  const { dirs, env } = sandbox(t);
  await callAccount({ ...env, TICKERDB_API_KEY: "not-a-tickerdb-key" }, dirs.cwd, /Invalid TickerDB API key format/);
});

// A malformed key proves which source was read without calling the real API.
test("reads the key from the project .env", async (t) => {
  const { dirs, env } = sandbox(t);
  writeFileSync(join(dirs.cwd, ".env"), "TICKERDB_API_KEY=from-dotenv\n");
  await callAccount(env, dirs.cwd, /Invalid TickerDB API key format/);
});

test("reads the key from the user config file", async (t) => {
  const { dirs, env, configFile } = sandbox(t);
  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, JSON.stringify({ api_key: "from-config" }));
  await callAccount(env, dirs.cwd, /Invalid TickerDB API key format/);
});
