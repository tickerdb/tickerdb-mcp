// Test-only Worker: the production Worker with its TICKERDB service binding replaced
// by an in-process stub API, so store_as / query_data run against the real
// Durable Object store in workerd (remote/test/remote-store.test.mjs).
import worker, { TickerDbStore } from "../src/index.js";

export { TickerDbStore };

const BAR_COUNT = 2500;
const day = (i: number) => {
  const d = new Date(Date.UTC(2015, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({ date: day(i), open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1000 + i }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubApi(req: Request): Response {
  const url = new URL(req.url);
  const p = url.searchParams;
  const path = url.pathname.replace(/^\/v1/, "");
  if (path === "/ohlcv/AAPL") {
    const n = Math.min(Number(p.get("limit") ?? 100), 1000);
    const cursor = p.get("cursor");
    let bars = [...BARS].reverse();
    if (cursor) bars = bars.filter((b) => b.date < cursor);
    const page = bars.slice(0, n);
    const more = bars.length > n;
    return json({ ticker: "AAPL", timeframe: "daily", has_more: more, next_cursor: more ? page.at(-1)!.date : null, bars: page });
  }
  if (path === "/universe") {
    // 150 fields per row: past the Durable Object's 100-column limit.
    const rows = Array.from({ length: 300 }, (_, i) => {
      const row: Record<string, unknown> = { ticker: `T${i}` };
      for (let f = 0; f < 150; f++) row[`f${f}`] = f === 120 ? i : `v${f}`;
      return row;
    });
    return json({ date: "2026-11-05", timeframe: "daily", row_count: rows.length, rows });
  }
  return json({ error: { message: `stub: no route ${path}` } }, 404);
}

export default {
  fetch(request: Request, env: Record<string, unknown>) {
    return worker.fetch(request, { ...env, TICKERDB: { fetch: async (input: RequestInfo | URL) => stubApi(new Request(input)) } } as never);
  },
};
