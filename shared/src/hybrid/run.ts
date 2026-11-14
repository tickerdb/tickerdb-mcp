// Runs an operation: one call inline, or into the store (optionally following pages).
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { findRows, type Op } from "./ops.js";
import { flattenRow, type DataStore } from "./store.js";

type Args = Record<string, unknown>;
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { data: unknown };
  isError?: boolean;
};

export interface RunLimits {
  /** fetch_all stops after this many pages. */
  maxPages: number;
  /** fetch_all stops after this many rows. */
  maxRows: number;
  /** Inline results larger than this go into a table automatically (0 = never). */
  inlineMaxChars: number;
  /** Rows per /v1/history page when the caller gives no limit (undefined = the plan's page size). */
  historyPageRows?: number;
}

export const DEFAULT_LIMITS: RunLimits = { maxPages: 500, maxRows: 2_000_000, inlineMaxChars: 40_000 };

export interface RunContext {
  apiKey: string;
  /** Absent when this server has nowhere to keep tables. */
  store?: DataStore;
  limits: RunLimits;
}

export interface StoreOptions {
  store_as?: string;
  append?: boolean;
  fetch_all?: boolean;
}

export const NO_STORE = "store_as, fetch_all and query_data are not available on this server. Page through the result with limit and offset, cursor or page_token.";

export const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

/**
 * A successful result: the text for every client plus structuredContent { data }
 * for ChatGPT apps (every tool declares OUTPUT_SCHEMA). A stored result's data is
 * its summary, never the stored rows.
 */
export const ok = (data: unknown, body = JSON.stringify(data)): ToolResult => ({
  content: [{ type: "text", text: body }],
  structuredContent: { data },
});

const tablePrefix = (op: Op) => op.name.replace(/^get_/, "");

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
    if (v === rowsRef || k === "band_contract" || k === "next_page_token") continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    }
  }
  return out;
}

/** Whether a response says there is more to fetch. */
function hasMorePages(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  return Boolean(data.has_more || data.next_cursor || data.next_page_token || (Array.isArray(data.page_tokens) && data.page_tokens.length));
}

/** One API call for an op: GET with a query string, POST with a JSON body, or POST with a query string (op.method). */
async function callOp(apiKey: string, op: Op, args: Args) {
  const { path, query, body } = op.request(args);
  if (body) return callTickerDb(apiKey, path, undefined, { method: "POST", body });
  return callTickerDb(apiKey, path, query, op.method === "POST" ? { method: "POST" } : undefined);
}

const rawCounts = new WeakMap<object, number>();

/** Apply an op's MCP-side row filter in place; returns the row array. */
function pageRows(op: Op, data: any): unknown[] | undefined {
  const rows = (op.rows ?? findRows)(data);
  if (rows && data && typeof data === "object") rawCounts.set(data, rawCounts.get(data) ?? rows.length);
  if (rows && op.localFilter) {
    const keep = op.localFilter(rows);
    if (keep.length !== rows.length) {
      rows.length = 0;
      rows.push(...keep);
      if (data && typeof data === "object") data.row_count_after_filters = rows.length;
    }
  }
  return rows;
}

export async function runOp(ctx: RunContext, baseOp: Op, args: Args, opts: StoreOptions): Promise<ToolResult> {
  let op: Op = baseOp;
  if (baseOp.resolve) {
    try {
      ({ op, args } = baseOp.resolve(args));
    } catch (e) {
      return text((e as Error).message, true);
    }
  }
  if (op.paging === "tokens" && args.limit === undefined && ctx.limits.historyPageRows) {
    args = { ...args, limit: ctx.limits.historyPageRows };
  }
  const { store } = ctx;
  let table = opts.store_as?.trim() || undefined;
  if ((table || opts.fetch_all) && !store) return text(NO_STORE, true);
  if (opts.fetch_all && !table) table = await store!.autoName(tablePrefix(op));

  if (!table || !store) {
    const { status, data } = await callOp(ctx.apiKey, op, args);
    if (status !== 200) return formatApiError(status, data);
    const rows = pageRows(op, data);
    if (op.route && data && typeof data === "object" && !Array.isArray(data)) (data as any).route = op.route;
    const body = JSON.stringify(data);
    if (store && ctx.limits.inlineMaxChars > 0 && body.length > ctx.limits.inlineMaxChars && rows && rows.length > 0) {
      const auto = await store.autoName(tablePrefix(op));
      return storePages(ctx, store, op, args, { store_as: auto }, { status, data }, `Result was ${body.length} chars, so it was stored instead of returned.`);
    }
    return ok(data, body);
  }
  return storePages(ctx, store, op, args, { ...opts, store_as: table });
}

async function storePages(
  ctx: RunContext,
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
    await store.begin(table, source, opts.append);
  } catch (e) {
    return text((e as Error).message, true);
  }

  const { maxPages, maxRows } = ctx.limits;
  const follow = Boolean(opts.fetch_all && op.paging);
  const pageArgs: Args = { ...args };
  if (follow && pageArgs.limit === undefined && op.maxLimit) pageArgs.limit = op.maxLimit;
  if (follow && op.paging === "offset" && pageArgs.offset === undefined) pageArgs.offset = 0;

  const tokenQueue: string[] = [];
  let pages = 0;
  let total = 0;
  let meta: Record<string, unknown> | undefined;
  let stopped: string | undefined;
  let more = false;

  for (;;) {
    let res = first;
    first = undefined;
    if (!res) res = await callOp(ctx.apiKey, op, pageArgs);
    const { status, data } = res;
    if (status !== 200) {
      if (pages === 0) return formatApiError(status, data);
      stopped = `page ${pages + 1} failed (${status}): ${(data as any)?.error?.message ?? "error"}`;
      break;
    }
    pages += 1;
    const rawRows = pageRows(op, data);
    const served = (data && typeof data === "object" ? rawCounts.get(data) : undefined) ?? rawRows?.length ?? 0;
    const rows = rawRows ?? [data];
    if (!meta) meta = envelope(data, rawRows);
    const hoisted = op.hoist?.(data, pageArgs) ?? {};
    const flat = rows.map((r) => {
      const f = flattenRow(r);
      for (const [k, v] of Object.entries(hoisted)) if (v !== undefined && !(k in f)) f[k] = v as never;
      return f;
    });
    try {
      await store.insert(table, flat);
    } catch (e) {
      return text(`Storing into ${table} failed: ${(e as Error).message}`, true);
    }
    total += flat.length;

    if (!follow) {
      more = Boolean(op.paging) && hasMorePages(data);
      break;
    }
    if (!rawRows || served === 0) break;
    if (pages >= maxPages) { stopped = `page cap ${maxPages} reached`; break; }
    if (total >= maxRows) { stopped = `row cap ${maxRows} reached`; break; }

    if (op.paging === "cursor") {
      const next = (data as any)?.next_cursor;
      if (!(data as any)?.has_more || !next) break;
      pageArgs.cursor = next;
    } else if (op.paging === "offset") {
      if (!(data as any)?.has_more) break;
      pageArgs.offset = Number(pageArgs.offset ?? 0) + rawRows.length;
    } else if (op.paging === "offset_full") {
      // No has_more: a full page means there may be more.
      if (served < Number(pageArgs.limit ?? 0)) break;
      pageArgs.offset = Number(pageArgs.offset ?? 0) + served;
      if (Number(pageArgs.offset) > 10_000) { stopped = "offset cap 10,000 reached"; break; }
    } else if (op.paging === "tokens") {
      // History: the first page lists page_tokens for every other page; any page
      // may also continue itself with next_page_token. Same params on every page.
      if (pages === 1) tokenQueue.push(...(((data as any)?.page_tokens ?? []) as string[]));
      const own = (data as any)?.next_page_token;
      if (own) tokenQueue.unshift(own);
      const next = tokenQueue.shift();
      if (!next) break;
      pageArgs.page_token = next;
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
    ...(op.route ? { route: op.route } : {}),
    ...(await store.summary(table)),
    ...(opts.append ? { rows_added: total } : {}),
    pages,
    ...(stopped ? { stopped } : {}),
    ...(more ? { more_pages: "This is the first page only: repeat with fetch_all=true to store every page." } : {}),
    ...(note ? { note } : {}),
    response: meta,
    next: `query_data with SQL over ${table}`,
  };
  return ok(summary);
}
