// Experimental "hybrid" TickerDB MCP server: a few first-class tools with short
// descriptions, the long tail behind search_tools/call_tool, and an in-memory
// SQLite store (store_as + query_data) so large results stay out of the context.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPS, checkParams, describeOp, searchOps } from "./ops.js";
import { QUERY_OP } from "./query.js";
import { runOp } from "./run.js";
import { DataStore, QUERY_MAX_ROWS } from "./store.js";

export const HYBRID_INSTRUCTIONS =
  "TickerDB: point-in-time market data for stocks, ETFs and crypto as named bands (e.g. momentum_rsi_zone) plus raw values. " +
  "Look up field names with get_schema search (e.g. search=\"rsi zone\", level=market) instead of guessing. " +
  "Every band also has _prev, _periods, _flips_recent_count, _flips_lookback and _stability, usable as fields and filters (_periods = 1: changed that row). " +
  "Use query for any cross-section or history: filter and sort on the server rather than pulling rows and filtering yourself. " +
  "For multi-year research prefer timeframe=weekly. " +
  "For large pulls pass store_as=<table> plus fetch_all=true: rows go into a local SQLite table and you get a short summary; then use query_data (SQL; output_path for CSV). " +
  "Other endpoints (changes, insiders, funds, indexes, status, account): search_tools, then call_tool. " +
  "A row dated D is known on D+1: act at the next session.";

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

const tf = z.enum(["daily", "weekly"]).optional().describe("Default: daily on Pro/Commercial, weekly on Free/Plus.");
const day = (what: string) => z.string().optional().describe(`${what} (YYYY-MM-DD).`);
const storeParams = {
  store_as: z.string().optional().describe("Table name: store rows in local SQLite, return only a summary. Read with query_data."),
  append: z.boolean().optional().describe("Add rows to an existing store_as table instead of replacing it."),
};
const fetchAll = {
  fetch_all: z.boolean().optional().describe("Follow every page into store_as in this one call."),
};

type Args = Record<string, unknown>;

function split(args: Args) {
  const { store_as, append, fetch_all, ...rest } = args;
  return { rest, opts: { store_as: store_as as string | undefined, append: append as boolean | undefined, fetch_all: fetch_all as boolean | undefined } };
}

export function createHybridServer(apiKey: string): McpServer {
  const store = new DataStore();
  const server = new McpServer(
    { name: "TickerDB", version: "2.0.0-hybrid" },
    { instructions: HYBRID_INSTRUCTIONS },
  );

  const run = (name: string) => async (args: Args) => {
    const { rest, opts } = split(args);
    return runOp(apiKey, store, OPS[name], rest, opts);
  };

  server.tool(
    "get_schema",
    "Look up field names, descriptions, units and band values. Search rather than pulling everything (~230 KB): search=\"bull flag\", category=patterns, level=market. Names are <group>_<name>[_<unit>]; bands end in a category word (_zone, _state, _trend), raw numbers in a unit (_pct, _ratio, _usd). Every band (tracked: true) also has _prev, _periods, _flips_recent_count, _flips_lookback and _stability, usable as fields and filters; lookups omit those rows unless markers=true. Over 25 matches lists names only: search again by exact name for a description.",
    {
      search: z.string().optional().describe("Words that must all appear in name, category or description."),
      category: z.string().optional().describe("Comma-separated, e.g. patterns,volume."),
      level: z.enum(["ticker", "market"]).optional().describe("ticker = per-asset fields; market = market_*/macro_*."),
      compact: z.boolean().optional().describe("Name, type, values and description only."),
      markers: z.boolean().optional().describe("Include change-marker fields."),
      ...storeParams,
    },
    RO,
    run("get_schema"),
  );

  server.tool(
    "query",
    "One tool for any cross-section or history; use get_summary for a single ticker's full snapshot. Give fields and filters (any ticker field; names from get_schema), then EITHER date (default latest) OR start+end. One date with filters, tickers, sort_by or a limit screens and ranks; one date with neither returns every asset; a range returns every row in it (market_/macro_ filters keep only dates in that regime). Ranges over ~6 months default to weekly. For big pulls use store_as + fetch_all, then query_data.",
    {
      fields: z.array(z.string()).optional().describe('Columns, e.g. ["market_cap_usd","momentum_rsi_zone"]. Max 60 per date, 30 per range.'),
      filters: z
        .array(z.object({ field: z.string(), op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte"]), value: z.unknown() }))
        .optional()
        .describe('E.g. [{"field":"momentum_rsi_zone","op":"in","value":["oversold"]}].'),
      tickers: z.array(z.string()).optional().describe("Only these tickers."),
      date: day("One date; default latest"),
      start: day("Range start, with end"),
      end: day("Range end"),
      timeframe: z.enum(["daily", "weekly"]).optional().describe("Default: weekly for ranges over ~6 months, else your plan's default."),
      asset_class: z.enum(["stock", "etf", "crypto"]).optional(),
      member_of: z.string().optional().describe("Index id, e.g. sp500 (point in time)."),
      held_by: z.string().optional().describe("Fund ticker or SEC series id."),
      sort_by: z.string().optional().describe("Ticker field to rank by (one date)."),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      limit: z.number().int().min(1).optional().describe("Max rows on one date (default 20, max 500); rows per page on a range."),
      ohlcv: z.boolean().optional().describe("Range only: add ohlcv_open/high/low/close/volume."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("With ohlcv; default split."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    async (args: Args) => {
      const { rest, opts } = split(args);
      return runOp(apiKey, store, QUERY_OP, rest, opts);
    },
  );

  server.tool(
    "get_summary",
    "One ticker's state: latest snapshot, one date, a start/end series, or band events (field, optional band: when it was entered, what it left, how long it lasted; stats=true for counts). fields trims to sections or paths, e.g. trend, momentum.rsi_zone, fundamentals.pe_ratio. Market regimes are in get_market.",
    {
      ticker: z.string().describe("e.g. AAPL, BTCUSD, SPY"),
      timeframe: tf,
      date: day("Snapshot date"),
      start: day("Series start"),
      end: day("Series end"),
      fields: z.array(z.string()).optional().describe("Sections or dotted paths."),
      meta: z.boolean().optional().describe("Include _meta stability objects."),
      field: z.string().optional().describe("Band field for events, e.g. momentum_rsi_zone."),
      band: z.string().optional().describe("Events for this band value only."),
      sample: z.enum(["even"]).optional().describe("Evenly spaced rows across start/end."),
      limit: z.number().int().min(1).max(50).optional().describe("Events, or sampled rows."),
      before: day("Events before"),
      after: day("Events after"),
      stats: z.boolean().optional().describe("Event counts instead of rows."),
      context_ticker: z.string().optional().describe("Second ticker to condition events on."),
      context_field: z.string().optional().describe("Band field on context_ticker."),
      context_band: z.string().optional().describe("Band value on context_ticker."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("Price basis; default split."),
      ...storeParams,
    },
    RO,
    run("get_summary"),
  );

  server.tool(
    "get_market",
    "Market-level rows, one per date, point in time: US equity market regime (market_*) and economy (macro_*) bands and values, e.g. market_regime_zone, macro_yield_curve_zone. changes=true returns only dates where a band changed. Field list: get_schema level=market. To find tickers under a regime, put market_/macro_ filters into query.",
    {
      fields: z.string().optional().describe('JSON array of market fields; ["*"] adds change markers.'),
      filters: z.string().optional().describe("JSON array of {field, op, value} on market fields."),
      changes: z.string().optional().describe("true, or a JSON array of bands to watch."),
      timeframe: tf,
      date: day("One date"),
      start: day("Range start"),
      end: day("Range end"),
      order: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      limit: z.number().int().min(1).max(2000).optional().describe("Range rows; default 100."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    run("get_market"),
  );

  server.tool(
    "get_ohlcv",
    "End-of-day OHLCV candles for one ticker, daily or weekly (weeks dated by Sunday). Paged: pass next_cursor back as cursor, or use store_as with fetch_all for the whole range in one call. 1 credit per 100 bars.",
    {
      ticker: z.string().describe("e.g. AAPL"),
      timeframe: tf,
      start: day("Start, inclusive"),
      end: day("End, inclusive"),
      limit: z.number().int().min(1).max(1000).optional().describe("Default 100."),
      order: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      cursor: z.string().optional().describe("next_cursor from the previous page."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("Default split; split_dividend = total return."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    run("get_ohlcv"),
  );

  server.tool(
    "search_tools",
    "Find the other TickerDB endpoints: changes, insiders, insider trades, funds, fund holdings and holders, indexes, index members, status, account, and the raw search and universe routes. Returns each match's name, purpose and params (* = required). Empty query lists all. Run one with call_tool.",
    { query: z.string().optional().describe("Words, e.g. insider trades.") },
    RO,
    async ({ query }) => {
      const ops = searchOps(query ?? "");
      const body = ops.length ? ops.map(describeOp).join("\n") : `No match. Try: ${searchOps("").map((o) => o.name).join(", ")}.`;
      return { content: [{ type: "text" as const, text: body }] };
    },
  );

  server.tool(
    "call_tool",
    "Run an endpoint found with search_tools: its name plus a params object. store_as, append and fetch_all work as on the other data tools.",
    {
      name: z.string().describe("e.g. get_insider_trades"),
      params: z.record(z.unknown()).optional().describe("Endpoint params."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    async ({ name, params, store_as, append, fetch_all }) => {
      const op = OPS[name];
      if (!op || !op.params) {
        const hint = OPS[name] ? `${name} is a first-class tool: call it directly.` : `Unknown tool "${name}". Use search_tools.`;
        return { isError: true, content: [{ type: "text" as const, text: hint }] };
      }
      let args: Args;
      try {
        args = checkParams(op, (params ?? {}) as Args);
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
      }
      return runOp(apiKey, store, op, args, { store_as, append, fetch_all });
    },
  );

  server.tool(
    "query_data",
    `Read-only SQL (SQLite) over tables saved with store_as: SELECT or WITH, plus SHOW TABLES and DESCRIBE <table>. Returns at most ${QUERY_MAX_ROWS} rows; output_path writes the full result to a CSV file for bulk work. Nested fields are flattened with _ (trend.direction -> trend_direction); booleans are 1/0.`,
    {
      sql: z.string().describe("One statement."),
      max_rows: z.number().int().min(1).max(QUERY_MAX_ROWS).optional().describe(`Default ${QUERY_MAX_ROWS}.`),
      output_path: z.string().optional().describe("CSV file path for the full result."),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async ({ sql, max_rows, output_path }) => {
      try {
        const result = store.query(sql, max_rows ?? QUERY_MAX_ROWS, output_path);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
      }
    },
  );

  return server;
}
