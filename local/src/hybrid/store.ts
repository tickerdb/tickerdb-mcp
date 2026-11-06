// In-memory SQLite store for the hybrid server: tool results go into tables here
// and the agent reads them with SQL instead of paging rows through its context.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SAMPLE_ROWS = 5;
const SAMPLE_MAX_COLUMNS = 40;
const SAMPLE_MAX_STRING = 80;
export const QUERY_MAX_ROWS = 200;

type Row = Record<string, unknown>;

interface TableInfo {
  columns: string[];
  rows: number;
  source: string;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Nested objects become prefix_key columns; arrays become JSON text; booleans 1/0. */
export function flattenRow(row: unknown, prefix = "", out: Row = {}): Row {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    out[prefix || "value"] = toSql(row);
    return out;
  }
  for (const [k, v] of Object.entries(row as Row)) {
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

function toSql(v: unknown): SQLInputValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  return JSON.stringify(v);
}

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > SAMPLE_MAX_STRING ? `${v.slice(0, SAMPLE_MAX_STRING)}…` : v;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class DataStore {
  private db: DatabaseSync;
  private tables = new Map<string, TableInfo>();

  constructor() {
    // getBuiltinModule keeps the bundler from rewriting "node:sqlite" to "sqlite".
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("node:sqlite is unavailable: the hybrid server needs Node 22.5 or newer.");
    this.db = new sqlite.DatabaseSync(":memory:");
  }

  /** Start (or, with append, continue) a table. */
  begin(name: string, source: string, append = false): void {
    if (!TABLE_NAME.test(name)) {
      throw new Error(`store_as must be a plain table name (letters, digits, _; max 63), got "${name}".`);
    }
    const key = name.toLowerCase();
    const existing = this.tables.get(key);
    if (existing && append) {
      existing.source = source;
      return;
    }
    this.db.exec(`DROP TABLE IF EXISTS ${q(name)}`);
    this.tables.delete(key);
    this.tables.set(key, { columns: [], rows: 0, source });
    this.tableNames.set(key, name);
  }

  private tableNames = new Map<string, string>();

  insert(name: string, rows: Row[]): void {
    if (rows.length === 0) return;
    const key = name.toLowerCase();
    const info = this.tables.get(key);
    if (!info) throw new Error(`table ${name} not started`);
    const tableName = this.tableNames.get(key) ?? name;
    const known = new Set(info.columns.map((c) => c.toLowerCase()));
    const added: string[] = [];
    for (const row of rows) {
      for (const col of Object.keys(row)) {
        const lc = col.toLowerCase();
        if (!known.has(lc)) {
          known.add(lc);
          added.push(col);
        }
      }
    }
    if (info.columns.length === 0) {
      this.db.exec(`CREATE TABLE ${q(tableName)} (${added.map(q).join(", ")})`);
      info.columns.push(...added);
    } else {
      for (const col of added) {
        this.db.exec(`ALTER TABLE ${q(tableName)} ADD COLUMN ${q(col)}`);
        info.columns.push(col);
      }
    }
    // One statement per distinct column set keeps sparse rows cheap.
    const stmts = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        const cols = Object.keys(row);
        const sig = cols.join("\u0000");
        let stmt = stmts.get(sig);
        if (!stmt) {
          stmt = this.db.prepare(
            `INSERT INTO ${q(tableName)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          );
          stmts.set(sig, stmt);
        }
        stmt.run(...(cols.map((c) => row[c]) as SQLInputValue[]));
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    info.rows += rows.length;
  }

  summary(name: string): { table: string; row_count: number; columns: string[]; sample: unknown[][]; sample_columns?: string[] } {
    const key = name.toLowerCase();
    const info = this.tables.get(key);
    const tableName = this.tableNames.get(key) ?? name;
    if (!info || info.columns.length === 0) {
      return { table: tableName, row_count: 0, columns: [], sample: [] };
    }
    const cols = info.columns.slice(0, SAMPLE_MAX_COLUMNS);
    const stmt = this.db.prepare(`SELECT ${cols.map(q).join(", ")} FROM ${q(tableName)} LIMIT ${SAMPLE_ROWS}`);
    stmt.setReturnArrays(true);
    const sample = (stmt.all() as unknown as unknown[][]).map((r) => r.map(clip));
    return {
      table: tableName,
      row_count: info.rows,
      columns: info.columns,
      ...(cols.length < info.columns.length ? { sample_columns: cols } : {}),
      sample,
    };
  }

  showTables(): unknown {
    return {
      tables: [...this.tables.entries()].map(([key, t]) => ({
        table: this.tableNames.get(key) ?? key,
        rows: t.rows,
        columns: t.columns.length,
        source: t.source,
      })),
    };
  }

  describe(name: string): unknown {
    const key = name.toLowerCase();
    const info = this.tables.get(key);
    if (!info) throw new Error(`No stored table "${name}". SHOW TABLES lists them.`);
    const tableName = this.tableNames.get(key) ?? name;
    const columns = info.columns.map((c) => {
      const r = this.db.prepare(`SELECT typeof(${q(c)}) AS t FROM ${q(tableName)} WHERE ${q(c)} IS NOT NULL LIMIT 1`).get() as
        | { t: string }
        | undefined;
      return [c, r?.t ?? "null"];
    });
    return { table: tableName, row_count: info.rows, source: info.source, columns };
  }

  /** Read-only SQL. Returns up to maxRows rows; with outputPath writes every row to CSV. */
  query(sql: string, maxRows = QUERY_MAX_ROWS, outputPath?: string): unknown {
    const text = stripComments(sql).trim().replace(/;\s*$/, "");
    if (/^show\s+tables$/i.test(text)) return this.showTables();
    const desc = text.match(/^(?:describe|desc)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?$/i);
    if (desc) return this.describe(desc[1]);
    if (!/^(select|with)\b/i.test(text)) {
      throw new Error("Only read-only SQL: SELECT or WITH, plus SHOW TABLES and DESCRIBE <table>.");
    }
    if (text.includes(";")) throw new Error("One statement per call.");
    const limit = Math.max(1, Math.min(QUERY_MAX_ROWS, Math.floor(maxRows)));

    this.db.exec("PRAGMA query_only = 1");
    try {
      const stmt = this.db.prepare(text);
      stmt.setReturnArrays(true);
      const columns = stmt.columns().map((c) => c.name);
      const rows: unknown[][] = [];
      let total = 0;
      let fd: number | undefined;
      let fullPath: string | undefined;
      let buf: string[] = [];
      if (outputPath) {
        fullPath = resolve(outputPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        fd = openSync(fullPath, "w");
        buf.push(columns.map(csvCell).join(","));
      }
      try {
        for (const r of stmt.iterate() as Iterable<unknown[]>) {
          total += 1;
          if (rows.length < limit) rows.push(r);
          if (fd !== undefined) {
            buf.push(r.map(csvCell).join(","));
            if (buf.length >= 5000) {
              writeSync(fd, buf.join("\n") + "\n");
              buf = [];
            }
          }
        }
        if (fd !== undefined && buf.length) writeSync(fd, buf.join("\n") + "\n");
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
      return {
        columns,
        row_count: total,
        ...(total > rows.length ? { returned: rows.length, truncated: true } : {}),
        ...(fullPath ? { csv: fullPath } : {}),
        rows,
      };
    } finally {
      this.db.exec("PRAGMA query_only = 0");
    }
  }
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
