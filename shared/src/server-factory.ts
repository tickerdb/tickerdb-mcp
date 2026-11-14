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
  add_watchlist_tickers: ["/watchlist/add"],
  remove_watchlist_tickers: ["/watchlist/remove"],
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
  "TickerDB: point-in-time market data for stocks, ETFs and crypto, as named bands (momentum_rsi_zone = \"oversold\") plus raw values. " +
  "Look up field names with get_schema (search=\"rsi zone\", level=market) instead of guessing. " +
  "null means unknown, not zero or low. " +
  "Every band also has _prev, _periods, _flips_recent_count, _flips_lookback and _stability, usable as fields and filters; _periods = 1 means it changed on that row. " +
  "Use query for any cross-section or history: filter and sort on the server rather than pulling rows and filtering yourself. " +
  "For multi-year research prefer timeframe=weekly. " +
  "For large pulls pass store_as=<table> plus fetch_all=true: rows go into a SQLite table, you get a short summary, and query_data reads it with SQL. " +
  "The user's watchlist (one per account): add_watchlist_tickers and remove_watchlist_tickers change it; get_watchlist_changes (call_tool) says what changed since the last check, for a daily check. " +
  "Other endpoints (changes, watchlist, insiders, holdings, funds, indexes, TickerDB's own trading models, status, account): search_tools, then call_tool. " +
  "A row dated D is known on D+1: act at the next session's open.";

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

const tf = z.enum(["daily", "weekly"]).optional().describe("Default daily.");
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
      level: z.enum(["ticker", "market", "model"]).optional().describe("ticker = per-asset fields; market = market_*/macro_*; model = model_* (TickerDB's trading models)."),
      compact: z.boolean().optional().describe("Name, type, values and description only."),
      markers: z.boolean().optional().describe("Include change-marker fields."),
      ...storeParams,
    },
    RO,
    run("get_schema"),
  ));

  meta(server.tool(
    "query",
    "Any cross-section or history (one ticker's full snapshot: get_summary). Give fields and filters (names from get_schema), then EITHER date (default latest) OR start+end. One date with filters, tickers, sort_by or limit: a ranked screen. One date with only fields: every asset. A range: every row in it, weekly by default past ~6 months; market_/macro_ filters keep only dates in that regime, other filters apply after the rows are fetched, so narrow with tickers, member_of or asset_class. Big pulls: store_as + fetch_all, then query_data.",
    {
      fields: z.array(z.string()).optional().describe('Columns, e.g. ["market_cap_usd","momentum_rsi_zone"]. Max 30.'),
      filters: z
        .array(z.object({ field: z.string(), op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte"]), value: z.unknown() }))
        .optional()
        .describe('Up to 10; a row must match all of them, and null matches none. E.g. [{"field":"momentum_rsi_zone","op":"in","value":["oversold"]}].'),
      tickers: z.array(z.string()).optional().describe("Only these tickers."),
      date: day("One date; default latest"),
      start: day("Range start, with end"),
      end: day("Range end"),
      timeframe: z.enum(["daily", "weekly"]).optional().describe("Default: weekly for ranges over ~6 months, else daily."),
      asset_class: z.enum(["stock", "etf", "crypto"]).optional().describe("Only this asset class."),
      member_of: z.string().optional().describe("Only members of this index on the row's date, e.g. sp500. Ids: get_indexes."),
      held_by: z.string().optional().describe("Only assets this fund held on the row's date: fund ticker (IVV) or SEC series id."),
      sort_by: z.string().optional().describe("Ticker field to rank by (one date)."),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      limit: z.number().int().min(1).optional().describe("Rows on one date (default 20, max 250); rows per page on a range."),
      offset: z.number().int().min(0).optional().describe("One date: skip this many ranked rows."),
      page_token: z.string().optional().describe("Range: a token from page_tokens or next_page_token (same params)."),
      dry_run: z.boolean().optional().describe("Range: returns what it would cost in credits. No data, no charge."),
      ohlcv: z.boolean().optional().describe("Range only: add ohlcv_open/high/low/close/volume."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("With ohlcv: split (default), split_dividend (total return) or raw (as traded)."),
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
    "One ticker's state: latest snapshot, one date, a start/end series (up to 50 rows; for a longer range add sample=even or use query), or band events. For events give field and optionally band: each says when the band was entered, what it left and how long that had lasted; stats=true returns how often each band was entered. fields trims to sections, paths or field names, e.g. trend, momentum.rsi_zone, fundamentals_pe_ratio. Field names are the get_schema names everywhere (no aliases). Market regimes are in get_market.",
    {
      ticker: z.string().describe("e.g. AAPL, BTCUSD, SPY"),
      timeframe: tf,
      date: day("Snapshot date"),
      start: day("Series start"),
      end: day("Series end"),
      fields: z.array(z.string()).optional().describe("Sections, dotted paths, or get_schema field names."),
      meta: z.boolean().optional().describe("Add stability metadata (_meta) to every band."),
      field: z.string().optional().describe("Band field for events, e.g. momentum_rsi_zone."),
      band: z.string().optional().describe("Only changes into this value, e.g. oversold."),
      sample: z.enum(["even"]).optional().describe("Up to 50 rows spread evenly across start/end."),
      limit: z.number().int().min(1).max(50).optional().describe("Events (default 10), or sampled rows (default 50)."),
      before: day("Only events before"),
      after: day("Only events after"),
      stats: z.boolean().optional().describe("How often each band was entered, instead of the event list."),
      context_ticker: z.string().optional().describe("Keep only events when this second asset was in context_band, e.g. SPY. Needs context_field and context_band."),
      context_field: z.string().optional().describe("Band field on context_ticker."),
      context_band: z.string().optional().describe("Band value on context_ticker."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("Price basis: split (default), split_dividend (total return) or raw (as traded)."),
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
      changes: z.string().optional().describe("true: only dates where any band changed. Or a JSON array of the bands to watch."),
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
    "End-of-day OHLCV candles for one ticker, daily or weekly (weeks dated by Sunday). Paged: pass next_cursor back as cursor, or use store_as with fetch_all for the whole range in one call.",
    {
      ticker: z.string().describe("e.g. AAPL"),
      timeframe: tf,
      start: day("Start, inclusive"),
      end: day("End, inclusive"),
      limit: z.number().int().min(1).max(1000).optional().describe("Default 100."),
      order: z.enum(["asc", "desc"]).optional().describe("Default desc."),
      cursor: z.string().optional().describe("next_cursor from the previous page."),
      adjustment: z.enum(["split", "split_dividend", "raw"]).optional().describe("split (default), split_dividend (total return) or raw (as traded)."),
      ...storeParams,
      ...fetchAll,
    },
    RO,
    run("get_ohlcv"),
  ));

  // The account's watchlist: these change the account, so they are not read-only (call_tool is).
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const watchTickers = z.array(z.string()).min(1).max(50).describe("Ticker symbols, e.g. [\"NVDA\", \"AMD\"]. Up to 50.");
  meta(server.tool(
    "add_watchlist_tickers",
    "Add tickers to the user's TickerDB watchlist (one per account, shared with the website's Track buttons and Claude/ChatGPT watchlist links). Idempotent: already-present tickers come back in already; unknown ones in unknown; over the plan's limit (Free 10, Plus 50, Pro 200, Commercial 500) in over_limit. Free. Then get_watchlist_changes (call_tool) reports what changed for them since the last check.",
    { tickers: watchTickers },
    WRITE,
    run("add_watchlist_tickers"),
  ));
  meta(server.tool(
    "remove_watchlist_tickers",
    "Remove tickers from the user's TickerDB watchlist. Idempotent: tickers not on it come back in missing. Free.",
    { tickers: watchTickers },
    { ...WRITE, destructiveHint: true },
    run("remove_watchlist_tickers"),
  ));

  meta(server.tool(
    "search_tools",
    "Find the other TickerDB endpoints: changes, the watchlist and what changed for it, insiders, insider trades and holdings, funds, fund holdings and holders, indexes, index members, TickerDB's trading models (list, detail, history, holdings, trades; Pro and Commercial plans), status, account, and the raw search and universe routes. Returns each match's name, purpose and params (* = required). Empty query lists all. Run one with call_tool.",
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
