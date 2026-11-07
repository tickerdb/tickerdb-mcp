// The table store behind store_as / query_data. Two implementations share these
// rules: local/src/sqlite-store.ts (node:sqlite in memory, one per stdio process)
// and remote/src/store.ts (a SQLite Durable Object per account on the Worker).

export type SqlValue = string | number | bigint | null;
export type FlatRow = Record<string, SqlValue>;

export const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
/** Names the stores keep for themselves (store metadata, Cloudflare internals, SQLite). */
const RESERVED_TABLE = /^(_tdb_|_cf_|sqlite_)/i;
export const SAMPLE_ROWS = 5;
export const SAMPLE_MAX_COLUMNS = 40;
const SAMPLE_MAX_STRING = 80;
export const QUERY_MAX_ROWS = 200;

export interface TableSummary {
  table: string;
  row_count: number;
  columns: string[];
  sample_columns?: string[];
  sample: unknown[][];
  /** Remote store only: columns past the per-table cap, kept as JSON in _extra. */
  extra_columns?: string[];
}

export interface QueryOptions {
  maxRows: number;
  /** Local only: write every row of the result to this CSV file. */
  outputPath?: string;
  /** csv: return the (capped) rows as CSV text instead of JSON arrays. */
  format?: "json" | "csv";
}

export interface DataStore {
  /** A fresh table name for auto-stored results, e.g. search_3. */
  autoName(prefix: string): Promise<string>;
  /** Start a table (replacing one of that name), or with append keep adding to it. */
  begin(name: string, source: string, append?: boolean): Promise<void>;
  insert(name: string, rows: FlatRow[]): Promise<void>;
  summary(name: string): Promise<TableSummary>;
  /** Read-only SQL, SHOW TABLES or DESCRIBE <table>. */
  query(sql: string, opts: QueryOptions): Promise<unknown>;
}

export const quoteId = (id: string) => `"${id.replace(/"/g, '""')}"`;

export function checkTableName(name: string): void {
  if (!TABLE_NAME.test(name)) {
    throw new Error(`store_as must be a plain table name (letters, digits, _; max 63), got "${name}".`);
  }
  if (RESERVED_TABLE.test(name)) throw new Error(`store_as: names starting with _tdb_, _cf_ or sqlite_ are reserved.`);
}

/** Nested objects become prefix_key columns; arrays become JSON text; booleans 1/0. */
export function flattenRow(row: unknown, prefix = "", out: FlatRow = {}): FlatRow {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    out[prefix || "value"] = toSql(row);
    return out;
  }
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    let key = prefix ? `${prefix}_${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flattenRow(v, key, out);
      continue;
    }
    while (key in out) key = `${key}_`;
    out[key] = toSql(v);
  }
  return out;
}

function toSql(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  return JSON.stringify(v);
}

export function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > SAMPLE_MAX_STRING ? `${v.slice(0, SAMPLE_MAX_STRING)}…` : v;
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  return [columns.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

export type ParsedQuery = { kind: "show" } | { kind: "describe"; table: string } | { kind: "select"; text: string };

/** The read-only rules every store applies before running anything. */
export function parseQuery(sql: string): ParsedQuery {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().replace(/;\s*$/, "");
  if (/^show\s+tables$/i.test(text)) return { kind: "show" };
  const desc = text.match(/^(?:describe|desc)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?$/i);
  if (desc) return { kind: "describe", table: desc[1] };
  if (!/^(select|with)\b/i.test(text)) {
    throw new Error("Only read-only SQL: SELECT or WITH, plus SHOW TABLES and DESCRIBE <table>.");
  }
  if (text.includes(";")) throw new Error("One statement per call.");
  return { kind: "select", text };
}

export const clampRows = (maxRows: number) => Math.max(1, Math.min(QUERY_MAX_ROWS, Math.floor(maxRows)));

/** The query_data result shape, shared by both stores. */
export function queryResult(columns: string[], rows: unknown[][], total: number, format: QueryOptions["format"], extra: Record<string, unknown> = {}) {
  const head = { columns, row_count: total, ...(total > rows.length ? { returned: rows.length, truncated: true } : {}), ...extra };
  return format === "csv" ? { ...head, csv: toCsv(columns, rows) } : { ...head, rows };
}
