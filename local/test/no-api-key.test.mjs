import assert from "node:assert/strict";
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

async function assertDiscoveryWorks(t, env, expectedError) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/cli.js"],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "no-key-smoke", version: "1.0.0" });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(({ name }) => name).sort(),
    expectedTools,
  );

  const result = await client.callTool({
    name: "call_tool",
    arguments: { name: "get_account" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, expectedError);
}

test("starts and exposes tools without TICKERDB_KEY", async (t) => {
  await assertDiscoveryWorks(t, {}, /TICKERDB_KEY is required/);
});

test("starts and exposes tools with a malformed TICKERDB_KEY", async (t) => {
  await assertDiscoveryWorks(
    t,
    { TICKERDB_KEY: "not-a-tickerdb-key" },
    /Invalid TICKERDB_KEY format/,
  );
});
