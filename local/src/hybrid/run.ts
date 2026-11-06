// Runs an operation: one call inline, or into the store (optionally following pages).
import { callTickerDb } from "../../../shared/src/api-client.js";
import { formatApiError } from "../../../shared/src/errors.js";
import { findRows, type Op } from "./ops.js";
import { DataStore, flattenRow } from "./store.js";

type Args = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const MAX_PAGES = envInt("TICKERDB_FETCH_MAX_PAGES", 500);
const MAX_ROWS = envInt("TICKERDB_FETCH_MAX_ROWS", 2_000_000);
/** Inline results larger than this go into a table automatically (0 = never). */
const INLINE_MAX_CHARS = envInt("TICKERDB_INLINE_MAX_CHARS", 40_000);

export interface StoreOptions {
  store_as?: string;
  append?: boolean;
  fetch_all?: boolean;
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

let autoCounter = 0;

function dayShift(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Scalars from the response envelope (date, timeframe, has_more ...), for the stored-table summary. */
function envelope(data: any, rowsRef: unknown[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!data || typeof data !== "object") return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === rowsRef || k === "band_contract") continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    }
  }
  return out;
}

export async function runOp(apiKey: string, store: DataStore, op: Op, args: Args, opts: StoreOptions): Promise<ToolResult> {
  let table = opts.store_as?.trim() || undefined;
  if (opts.fetch_all && !table) table = `${op.name.replace(/^get_/, "")}_${++autoCounter}`;

  if (!table) {
    const { path, query } = op.request(args);
    const { status, data } = await callTickerDb(apiKey, path, query);
    if (status !== 200) return formatApiError(status, data);
    const body = JSON.stringify(data);
    if (INLINE_MAX_CHARS > 0 && body.length > INLINE_MAX_CHARS) {
      const rows = (op.rows ?? findRows)(data);
      if (rows && rows.length > 0) {
        const auto = `${op.name.replace(/^get_/, "")}_${++autoCounter}`;
        return storePages(apiKey, store, op, args, { store_as: auto }, { status, data }, `Result was ${body.length} chars, so it was stored instead of returned.`);
      }
    }
    return text(body);
  }
  return storePages(apiKey, store, op, args, { ...opts, store_as: table });
}

async function storePages(
  apiKey: string,
  store: DataStore,
  op: Op,
  args: Args,
  opts: StoreOptions & { store_as: string },
  first?: { status: number; data: any },
  note?: string,
): Promise<ToolResult> {
  const table = opts.store_as;
  const source = `${op.name} ${JSON.stringify(args)}`;
  try {
    store.begin(table, source, opts.append);
  } catch (e) {
    return text((e as Error).message, true);
  }

  const follow = Boolean(opts.fetch_all && op.paging);
  const pageArgs: Args = { ...args };
  if (follow && pageArgs.limit === undefined && op.maxLimit) pageArgs.limit = op.maxLimit;
  if (follow && op.paging === "offset" && pageArgs.offset === undefined) pageArgs.offset = 0;

  let pages = 0;
  let total = 0;
  let meta: Record<string, unknown> | undefined;
  let stopped: string | undefined;

  for (;;) {
    let res = first;
    first = undefined;
    if (!res) {
      const { path, query } = op.request(pageArgs);
      res = await callTickerDb(apiKey, path, query);
    }
    const { status, data } = res;
    if (status !== 200) {
      if (pages === 0) return formatApiError(status, data);
      stopped = `page ${pages + 1} failed (${status}): ${(data as any)?.error?.message ?? "error"}`;
      break;
    }
    pages += 1;
    const rawRows = (op.rows ?? findRows)(data);
    const rows = rawRows ?? [data];
    if (!meta) meta = envelope(data, rawRows);
    const hoisted = op.hoist?.(data, pageArgs) ?? {};
    const flat = rows.map((r) => {
      const f = flattenRow(r);
      for (const [k, v] of Object.entries(hoisted)) if (v !== undefined && !(k in f)) f[k] = v as never;
      return f;
    });
    try {
      store.insert(table, flat);
    } catch (e) {
      return text(`Storing into ${table} failed: ${(e as Error).message}`, true);
    }
    total += flat.length;

    if (!follow || !rawRows || rawRows.length === 0) break;
    if (pages >= MAX_PAGES) { stopped = `page cap ${MAX_PAGES} reached`; break; }
    if (total >= MAX_ROWS) { stopped = `row cap ${MAX_ROWS} reached`; break; }

    if (op.paging === "cursor") {
      const next = (data as any)?.next_cursor;
      if (!(data as any)?.has_more || !next) break;
      pageArgs.cursor = next;
    } else if (op.paging === "offset") {
      if (!(data as any)?.has_more) break;
      pageArgs.offset = Number(pageArgs.offset ?? 0) + rawRows.length;
    } else if (op.paging === "date") {
      // Market ranges have no cursor: a full page means there may be more, so
      // move the range edge past the last date returned.
      if (!pageArgs.start || !pageArgs.end || rawRows.length < Number(pageArgs.limit ?? 100)) break;
      const dates = rawRows.map((r: any) => String(r?.date ?? "")).filter(Boolean).sort();
      if (dates.length === 0) break;
      const desc = String(pageArgs.order ?? "desc") !== "asc";
      if (desc) pageArgs.end = dayShift(dates[0], -1);
      else pageArgs.start = dayShift(dates[dates.length - 1], 1);
      if (String(pageArgs.start) > String(pageArgs.end)) break;
    } else break;
  }

  const summary = {
    stored: true,
    ...store.summary(table),
    ...(opts.append ? { rows_added: total } : {}),
    pages,
    ...(stopped ? { stopped } : {}),
    ...(note ? { note } : {}),
    response: meta,
    next: `query_data with SQL over ${table}`,
  };
  return text(JSON.stringify(summary));
}
