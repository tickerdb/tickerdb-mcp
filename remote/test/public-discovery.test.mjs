import assert from "node:assert/strict";
import test from "node:test";
import { unstable_dev } from "wrangler";

const mcpHeaders = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

test("allows the complete unauthenticated MCP discovery handshake", async (t) => {
  const worker = await unstable_dev("remote/src/index.ts", {
    config: "remote/test/wrangler.jsonc",
    compatibilityDate: "2026-03-10",
    compatibilityFlags: ["nodejs_compat"],
    inspect: false,
    local: true,
    logLevel: "none",
    experimental: {
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      testMode: true,
      watch: false,
    },
  });

  t.after(async () => {
    await worker.stop();
  });

  const post = (body) =>
    worker.fetch("http://localhost/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify(body),
    });

  const initialize = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "public-discovery-test", version: "1.0.0" },
    },
  });
  assert.equal(initialize.status, 200);

  const initialized = await post({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.ok(
    initialized.status >= 200 && initialized.status < 300,
    `notifications/initialized returned ${initialized.status}: ${await initialized.text()}`,
  );

  const toolList = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  assert.equal(toolList.status, 200);

  const payload = await toolList.json();
  assert.deepEqual(
    payload.result.tools.map(({ name }) => name).sort(),
    [
      "add_to_watchlist",
      "get_account",
      "get_ohlcv",
      "get_schema",
      "get_search",
      "get_summary",
      "get_watchlist",
      "remove_from_watchlist",
    ],
  );
});
