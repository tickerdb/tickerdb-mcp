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
const OPS_ALLOWED = new Set(["eq", "neq", "in", "gt", "gte", "lt", "lte"]);

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
    return { field: f.field, op: String(f.op), value: f.value };
  });
}

function parseList(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw).trim();
  return s.startsWith("[") ? (JSON.parse(s) as unknown[]).map(String) : s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** One filter against one flat row, with /v1/search semantics (null never matches). */
export function matches(row: Record<string, unknown>, f: Filter): boolean {
  const v = row[f.field];
  if (v === null || v === undefined) return false;
  const cmp = (x: unknown) => {
    const a = typeof v === "number" ? v : String(v);
    const b = typeof v === "number" ? Number(x) : String(x);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  switch (f.op) {
    case "eq": return cmp(f.value) === 0;
    case "neq": return cmp(f.value) !== 0;
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
    const { date, start, end, sort_by, sort_direction, limit, asset_class, member_of, held_by, ohlcv, adjustment } = input as Record<string, any>;
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
        return {
          op: { ...OPS.get_search, name: "query", route: "/v1/search" },
          args: { filters: all, fields, sort_by, sort_direction, timeframe, start, end, limit, member_of, held_by },
        };
      }
      if (sort_by) throw new Error("sort_by works on one date. For a range, store_as then ORDER BY in query_data.");
      const wanted = fields ? [...fields] : [];
      for (const f of filters) if (f.field !== "ticker" && f.field !== "date" && !wanted.includes(f.field)) wanted.push(f.field);
      if (wanted.length === 0 && !ohlcv) throw new Error("A range needs fields (or ohlcv=true).");
      return {
        op: historyOp(filters),
        args: { tickers, fields: wanted.length ? wanted : undefined, timeframe, start, end, asset_class, member_of, held_by, ohlcv, adjustment, limit },
      };
    }

    // ---- One date (or latest) ----
    if (ohlcv || adjustment) throw new Error("ohlcv/adjustment apply to ranges; for one ticker's candles use get_ohlcv.");
    const useSearch = filters.length > 0 || limit !== undefined || sort_by !== undefined || Boolean(tickers?.length);
    if (useSearch) {
      const all = [...filters];
      if (tickers?.length) all.push({ field: "ticker", op: "in", value: tickers });
      if (asset_class) all.push({ field: "asset_class", op: "eq", value: asset_class });
      // /v1/search needs at least one filter; this one keeps every row.
      if (all.length === 0) all.push({ field: "ticker", op: "neq", value: "" });
      const lim = limit ?? (tickers?.length ? Math.min(500, tickers.length) : undefined);
      return {
        op: { ...OPS.get_search, name: "query", route: "/v1/search", paging: "offset_full", maxLimit: 500 },
        args: { filters: all, fields, sort_by, sort_direction, timeframe, date, limit: lim, member_of, held_by },
      };
    }
    if (!fields?.length) throw new Error("Every asset on one date needs fields (max 60). Or add filters / a limit.");
    return {
      op: { ...OPS.get_universe, name: "query", route: "/v1/universe" },
      args: { fields, date, timeframe, asset_class, member_of, held_by },
    };
  },
};
