// The TickerDB MCP server, served by both the stdio package (local/) and the Worker
// (remote/): a few first-class tools with short descriptions, every other /v1 route
// behind search_tools + call_tool, and a SQLite table store (store_as + query_data)
// so large results stay out of the agent's context.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPS, checkParams, describeOp, searchOps } from "./hybrid/ops.js";
import { QUERY_OP } from "./hybrid/query.js";
import { DEFAULT_LIMITS, NO_STORE, ok, runOp, text, type RunContext, type RunLimits } from "./hybrid/run.js";
import { QUERY_MAX_ROWS, type DataStore } from "./hybrid/store.js";

/** Keep aligned with server.json and local/package.json. */
export const SERVER_VERSION = "3.0.0";

/** The /v1 routes behind each first-class tool (the parity test reads this). */
export const FIRST_CLASS_ROUTES: Record<string, string[]> = {
  get_schema: ["/schema/fields"],
  query: ["/search", "/universe", "/history"],
  get_summary: ["/summary/[ticker]"],
  get_market: ["/market"],
  get_ohlcv: ["/ohlcv/[ticker]"],
};

/**
 * The one output schema every tool declares (ChatGPT apps read structuredContent):
 * { data } is the API response, a stored-table summary, a query_data result, or
 * search_tools' endpoint list.
 */
export const OUTPUT_SCHEMA = { data: z.unknown().describe("The tool's result.") };

/** Tool arguments the MCP server handles itself; they are never sent to the API. */
export const MCP_ONLY_PARAMS = ["store_as", "append", "fetch_all"];

export const SERVER_INSTRUCTIONS =
  "TickerDB: point-in-time market data for stocks, ETFs and crypto as named bands (e.g. momentum_rsi_zone) plus raw values. " +
  "Look up field names with get_schema search (e.g. search=\"rsi zone\", level=market) instead of guessing. " +
  "Every band also has _prev, _periods, _flips_recent_count, _flips_lookback and _stability, usable as fields and filters (_periods = 1: changed that row). " +
  "Use query for any cross-section or history: filter and sort on the server rather than pulling rows and filtering yourself. " +
  "For multi-year research prefer timeframe=weekly. " +
  "For large pulls pass store_as=<table> plus fetch_all=true: rows go into a SQLite table and you get a short summary; then use query_data (SQL). " +
  "Other endpoints (changes, insiders, holdings, funds, indexes, status, account): search_tools, then call_tool. " +
  "A row dated D is known on D+1: act at the next session.";

export interface ServerOptions {
  /** Where store_as tables live. Without one, store_as, fetch_all and query_data return an error. */
  store?: DataStore;
  limits?: Partial<RunLimits>;
  /** The stdio server: query_data can also write CSV files (output_path). */
  local?: boolean;
  /** Per-tool _meta (the Worker's OAuth securitySchemes). */
  toolMeta?: Record<string, unknown>;
  /** Where the store lives, for the query_data description. */
  storeNote?: string;
}

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

const tf = z.enum(["daily", "weekly"]).optional().describe("Default: daily (every plan reads daily and weekly).");
const day = (what: string) => z.string().optional().describe(`${what} (YYYY-MM-DD).`);
const storeParams = {
  store_as: z.string().optional().describe("Table name: store rows in SQLite, return only a summary. Read with query_data."),
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

/** apiKey may be a getter: the stdio server looks the key up per call (env, .env, config file). */
export function createTickerDbServer(apiKey: string | (() => string), options: ServerOptions = {}): McpServer {
  const ctx: RunContext = {
    get apiKey() {
      return typeof apiKey === "function" ? apiKey() : apiKey;
    },
    store: options.store,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
  };
  const server = new McpServer(
    {
      name: "TickerDB",
      version: SERVER_VERSION,
      description: "Point-in-time market data for AI agents: stocks, ETFs and crypto as named bands plus raw values.",
      websiteUrl: "https://tickerdb.com",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const meta = (tool: { update(u: { outputSchema?: typeof OUTPUT_SCHEMA; _meta?: Record<string, unknown> }): void }) => {
    tool.update({ outputSchema: OUTPUT_SCHEMA, ...(options.toolMeta ? { _meta: options.toolMeta } : {}) });
  };

  const run = (name: string) => async (args: Args) => {
    const { rest, opts } = split(args);
    return runOp(ctx, OPS[name], rest, opts);
  };

  meta(server.tool(
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
  ));

  meta(server.tool(
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
      timeframe: z.enum(["daily", "weekly"]).optional().describe("Default: weekly for ranges over ~6 months, else daily."),
      asset_class: z.enum(["stock", "etf", "crypto"]).optional(),
      member_of: z.string().optional().describe("Index id, e.g. sp500 (point in time)."),
      held_by: z.string().optional().describe("Fund ticker or SEC series id."),
      sort_by: z.string().optional().describe("Ticker field to rank by (one date)."),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      limit: z.number().int().min(1).optional().describe("Max rows on one date (default 20, max 500); rows per page on a range."),
      offset: z.number().int().min(0).optional().describe("One date: skip this many ranked rows."),
      page_token: z.string().optional().describe("Range: a token from page_tokens or next_page_token (same params)."),
      dry_run: z.boolean().optional().describe("Range: price it in credits, no data, no charge."),
      ohlcv: z.boolean().optional().describe("Range only: add ohlcv_open/high/low/close/volume."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("With ohlcv; default split."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    async (args: Args) => {
      const { rest, opts } = split(args);
      return runOp(ctx, QUERY_OP, rest, opts);
    },
  ));

  meta(server.tool(
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
  ));

  meta(server.tool(
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
  ));

  meta(server.tool(
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
  ));

  meta(server.tool(
    "search_tools",
    "Find the other TickerDB endpoints: changes, insiders, insider trades and holdings, funds, fund holdings and holders, indexes, index members, status, account, and the raw search and universe routes. Returns each match's name, purpose and params (* = required). Empty query lists all. Run one with call_tool.",
    { query: z.string().optional().describe("Words, e.g. insider trades.") },
    RO,
    async ({ query }) => {
      const ops = searchOps(query ?? "");
      const body = ops.length ? ops.map(describeOp).join("\n") : `No match. Try: ${searchOps("").map((o) => o.name).join(", ")}.`;
      return ok(body, body);
    },
  ));

  meta(server.tool(
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
        return text(hint, true);
      }
      let args: Args;
      try {
        args = checkParams(op, (params ?? {}) as Args);
      } catch (e) {
        return text((e as Error).message, true);
      }
      return runOp(ctx, op, args, { store_as, append, fetch_all });
    },
  ));

  const where = options.storeNote ? ` ${options.storeNote}` : "";
  const queryDataParams = {
    sql: z.string().describe("One statement."),
    max_rows: z.number().int().min(1).max(QUERY_MAX_ROWS).optional().describe(`Default ${QUERY_MAX_ROWS}.`),
    format: z.enum(["json", "csv"]).optional().describe("csv: rows as CSV text. Default json."),
    ...(options.local ? { output_path: z.string().optional().describe("CSV file path for the full result (every row).") } : {}),
  };
  meta(server.tool(
    "query_data",
    `Read-only SQL (SQLite) over tables saved with store_as: SELECT or WITH, plus SHOW TABLES and DESCRIBE <table>. Returns at most ${QUERY_MAX_ROWS} rows${options.local ? "; output_path writes the full result to a CSV file for bulk work" : ""}. Nested fields are flattened with _ (trend.direction -> trend_direction); booleans are 1/0.${where}`,
    queryDataParams,
    { readOnlyHint: !options.local, destructiveHint: false, openWorldHint: false },
    async (args: Args) => {
      if (!ctx.store) return text(NO_STORE, true);
      try {
        const result = await ctx.store.query(String(args.sql), {
          maxRows: (args.max_rows as number | undefined) ?? QUERY_MAX_ROWS,
          format: args.format as "json" | "csv" | undefined,
          outputPath: options.local ? (args.output_path as string | undefined) : undefined,
        });
        return ok(result);
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  ));

  return server;
}
