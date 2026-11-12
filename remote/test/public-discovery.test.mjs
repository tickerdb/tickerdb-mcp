import assert from "node:assert/strict";
import test from "node:test";
import { request as httpRequest } from "node:http";
import { unstable_dev } from "wrangler";

const mcpHeaders = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

async function startWorker(t, vars = {}) {
  const worker = await unstable_dev("remote/src/index.ts", {
    vars,
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
  return worker;
}

const initializeBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "public-discovery-test", version: "1.0.0" },
  },
};

// Owner 2026-11-12: sign-in is required up front, so Claude.ai and ChatGPT ask for it when the
// connector is added. An unsigned handshake gets 401 with the OAuth challenge.
test("requires sign-in for the handshake by default", async (t) => {
  const worker = await startWorker(t);
  // Plain HTTP: wrangler's fetch fails on a 401 to a request with a body ("expected non-null body source").
  const post = (body) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: worker.address, port: worker.port, path: "/mcp", method: "POST", headers: mcpHeaders }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
  for (const body of [initializeBody, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }]) {
    const res = await post(body);
    assert.equal(res.statusCode, 401, `${body.method} returned ${res.statusCode}`);
    assert.match(res.headers["www-authenticate"] ?? "", /resource_metadata=/);
  }
});

test("allows the complete unauthenticated MCP discovery handshake when MCP_PUBLIC_DISCOVERY=1", async (t) => {
  const worker = await startWorker(t, { MCP_PUBLIC_DISCOVERY: "1" });

  const post = (body) =>
    worker.fetch("http://localhost/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify(body),
    });

  const initialize = await post(initializeBody);
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
      "call_tool",
      "get_market",
      "get_ohlcv",
      "get_schema",
      "get_summary",
      "query",
      "query_data",
      "search_tools",
    ],
  );
});
