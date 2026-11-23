// The `query` tool: one entry point for any cross-section or history, routed to
//   /v1/search   one date with filters, a sort or a limit (or a range with a market_/macro_ filter)
//   /v1/universe one date, every asset, no filters
//   /v1/history  a date range (bulk; ticker filters applied here, per page)
import { OPS, type Op } from "./ops.js";

type Args = Record<string, unknown>;
export interface Filter {
  field: string;
  op: string;
  value: unknown;
}

const RANGE_WEEKLY_AFTER_DAYS = 183;
const HISTORY_POST_AFTER_TICKERS = 100;
/** /v1/search's own maximum `limit` (a larger one is a 400). */
export const SEARCH_MAX_LIMIT = 250;
const OPS_ALLOWED = new Set(["eq", "neq", "in", "gt", "gte", "lt", "lte"]);
const RANGE_OPS = new Set(["gt", "gte", "lt", "lte"]);

/**
 * /v1/search as the query tool calls it: fetch_all pages it by offset (a full page
 * means there may be more), at most 250 rows a page (audit K4: a range with a market
 * filter returned its first 20 rows looking complete).
 */
const searchOp = (): Op => ({ ...OPS.get_search, name: "query", route: "/v1/search", paging: "offset_full", maxLimit: SEARCH_MAX_LIMIT });

const isMarketField = (f: string) => /^(market|macro)_/.test(f);
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

function parseFilters(raw: unknown): Filter[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(list)) throw new Error("filters must be an array of {field, op, value}.");
  return list.map((f) => {
    if (!f || typeof f.field !== "string" || !OPS_ALLOWED.has(String(f.op))) {
      throw new Error(`Bad filter ${JSON.stringify(f)}: need {field, op: eq|neq|in|gt|gte|lt|lte, value}.`);
    }
    const filter = { field: f.field, op: String(f.op), value: f.value };
    // The API's own type rules (/v1/search validateFilterValue), so a range's local filters
    // refuse what a one-date screen would refuse instead of quietly matching something else.
    if (RANGE_OPS.has(filter.op) && (typeof filter.value !== "number" || !Number.isFinite(filter.value))) {
      throw new Error(`Bad filter ${JSON.stringify(f)}: ${filter.op} needs a number value.`);
    }
    if (filter.op === "in" && !Array.isArray(filter.value)) throw new Error(`Bad filter ${JSON.stringify(f)}: in needs an array value.`);
    if (typeof filter.value === "boolean" && filter.op !== "eq" && filter.op !== "neq") {
      throw new Error(`Bad filter ${JSON.stringify(f)}: a boolean takes eq or neq.`);
    }
    return filter;
  });
}

function parseList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw).trim();
  return s.startsWith("[") ? (JSON.parse(s) as unknown[]).map(String) : s.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * One filter against one flat row, with /v1/search's semantics (SQL on the column):
 * eq null is IS NULL and neq null IS NOT NULL; otherwise a null value never matches
 * (not even neq). A number filter compares numerically (/v1/history serves some
 * decimals as strings: "12.5" > 9), a boolean one as a boolean (true, 1, "true"),
 * a string one as text; an empty in matches nothing.
 */
export function matches(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.field];
  if (f.value === null && (f.op === "eq" || f.op === "neq")) return f.op === "eq" ? v === null || v === undefined : v !== null && v !== undefined;
  if (v === null || v === undefined) return false;
  const sample = Array.isArray(f.value) ? f.value[0] : f.value;
  const asBool = (x: unknown) => x === true || x === 1 || x === "true" || x === "1";
  const cmp = (x: unknown) => {
    if (typeof sample === "number") {
      const a = Number(v);
      const b = Number(x);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeof sample === "boolean") return asBool(v) === asBool(x) ? 0 : 1;
    const a = String(v);
    const b = String(x);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  switch (f.op) {
    case "eq": return cmp(f.value) === 0;
    case "neq": { const c = cmp(f.value); return !Number.isNaN(c) && c !== 0; }
    case "in": return Array.isArray(f.value) && f.value.some((x) => cmp(x) === 0);
    case "gt": return cmp(f.value) > 0;
    case "gte": return cmp(f.value) >= 0;
    case "lt": return cmp(f.value) < 0;
    case "lte": return cmp(f.value) <= 0;
    default: return false;
  }
}

const historyOp = (filters: Filter[]): Op => ({
  name: "query",
  apiRoute: "/history",
  route: "/v1/history",
  request: (a) => {
    const tickers = a.tickers as string[] | undefined;
    const q = {
      tickers: tickers?.join(","),
      fields: a.fields ? JSON.stringify(a.fields) : undefined,
      timeframe: a.timeframe as string | undefined,
      start: a.start as string | undefined,
      end: a.end as string | undefined,
      asset_class: a.asset_class as string | undefined,
      member_of: a.member_of as string | undefined,
      held_by: a.held_by as string | undefined,
      ohlcv: a.ohlcv === undefined ? undefined : String(a.ohlcv),
      adjustment: a.adjustment as string | undefined,
      limit: a.limit === undefined ? undefined : String(a.limit),
      page_token: a.page_token as string | undefined,
      dry_run: a.dry_run === undefined ? undefined : String(a.dry_run),
    };
    if (tickers && tickers.length > HISTORY_POST_AFTER_TICKERS) {
      // Long lists go in a POST body (same parameters).
      const body = Object.fromEntries(Object.entries({ ...q, tickers }).filter(([, v]) => v !== undefined));
      return { path: "/history", query: {}, body };
    }
    return { path: "/history", query: q };
  },
  rows: (d) => d?.rows,
  paging: "tokens",
  ...(filters.length
    ? { localFilter: (rows: unknown[]) => rows.filter((r) => filters.every((f) => matches(r as Record<string, unknown>, f))) }
    : {}),
});

export const QUERY_OP: Op = {
  name: "query",
  request: () => {
    throw new Error("query routes through resolve()");
  },
  resolve(input: Args) {
    const filters = parseFilters(input.filters);
    const fields = parseList(input.fields);
    const tickers = parseList(input.tickers)?.map((t) => t.trim().toUpperCase());
    const { date, start, end, sort_by, sort_direction, limit, offset, page_token, dry_run, asset_class, member_of, held_by, ohlcv, adjustment } =
      input as Record<string, any>;
    let timeframe = input.timeframe as string | undefined;

    if (date && (start || end)) throw new Error("Pass either date, or start and end, not both.");
    if (Boolean(start) !== Boolean(end)) throw new Error("A range needs both start and end.");

    // ---- Range ----
    if (start && end) {
      if (!timeframe && days(start, end) > RANGE_WEEKLY_AFTER_DAYS) timeframe = "weekly";
      const marketFilter = filters.some((f) => isMarketField(f.field));
      if (marketFilter) {
        // /v1/search screens a range only when a market filter picks the dates.
        const all = [...filters];
        if (tickers?.length) all.push({ field: "ticker", op: "in", value: tickers });
        if (asset_class) all.push({ field: "asset_class", op: "eq", value: asset_class });
        // /v1/search has no dry_run or page_token: refuse them rather than drop them
        // (a dropped dry_run ran, and charged, the search; audit K4).
        if (dry_run) throw new Error("dry_run prices /v1/history requests. A range with a market_/macro_ filter runs on /v1/search, which has no dry_run: drop dry_run to run it (it is charged), or drop the market filter to price a /v1/history pull.");
        if (page_token) throw new Error("page_token pages /v1/history. A range with a market_/macro_ filter runs on /v1/search: page it with offset, or fetch_all with store_as.");
        if (limit !== undefined && Number(limit) > SEARCH_MAX_LIMIT) throw new Error(`limit is at most ${SEARCH_MAX_LIMIT} per page on /v1/search; use fetch_all with store_as for more.`);
        return {
          op: searchOp(),
          args: { filters: all, fields, sort_by, sort_direction, timeframe, start, end, limit, offset, member_of, held_by },
        };
      }
      if (offset !== undefined) throw new Error("offset pages one-date screens. A range pages with page_token (or fetch_all).");
      if (sort_by) throw new Error("sort_by works on one date. For a range, store_as then ORDER BY in query_data.");
      const wanted = fields ? [...fields] : [];
      for (const f of filters) if (f.field !== "ticker" && f.field !== "date" && !wanted.includes(f.field)) wanted.push(f.field);
      if (wanted.length === 0 && !ohlcv) throw new Error("A range needs fields (or ohlcv=true).");
      return {
        op: historyOp(filters),
        args: { tickers, fields: wanted.length ? wanted : undefined, timeframe, start, end, asset_class, member_of, held_by, ohlcv, adjustment, limit, page_token, dry_run },
      };
    }

    // ---- One date (or latest) ----
    if (ohlcv || adjustment) throw new Error("ohlcv/adjustment apply to ranges; for one ticker's candles use get_ohlcv.");
    if (page_token || dry_run) throw new Error("page_token and dry_run apply to ranges (start and end).");
    const useSearch = filters.length > 0 || limit !== undefined || offset !== undefined || sort_by !== undefined || Boolean(tickers?.length);
    if (useSearch) {
      const all = [...filters];
      if (tickers?.length) all.push({ field: "ticker", op: "in", value: tickers });
      if (asset_class) all.push({ field: "asset_class", op: "eq", value: asset_class });
      // /v1/search needs at least one filter; this one keeps every row.
      if (all.length === 0) all.push({ field: "ticker", op: "neq", value: "" });
      if (limit !== undefined && Number(limit) > SEARCH_MAX_LIMIT) throw new Error(`limit is at most ${SEARCH_MAX_LIMIT} per page on /v1/search; use fetch_all with store_as for more.`);
      const lim = limit ?? (tickers?.length ? Math.min(SEARCH_MAX_LIMIT, tickers.length) : undefined);
      return {
        op: searchOp(),
        args: { filters: all, fields, sort_by, sort_direction, timeframe, date, limit: lim, offset, member_of, held_by },
      };
    }
    if (!fields?.length) throw new Error("Every asset on one date needs fields (max 30). Or add filters or a limit.");
    return {
      op: { ...OPS.get_universe, name: "query", route: "/v1/universe" },
      args: { fields, date, timeframe, asset_class, member_of, held_by },
    };
  },
};
