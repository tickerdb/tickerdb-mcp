// In-memory SQLite store for the stdio server (one per process): tool results go
// into tables here and the agent reads them with SQL instead of paging rows
// through its context. Rules shared with the Worker's store: shared/src/hybrid/store.ts.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SAMPLE_MAX_COLUMNS,
  SAMPLE_ROWS,
  checkTableName,
  clampRows,
  clip,
  csvCell,
  parseQuery,
  queryResult,
  quoteId as q,
  type DataStore,
  type FlatRow,
  type QueryOptions,
  type TableSummary,
} from "../../shared/src/hybrid/store.js";

interface TableInfo {
  name: string;
  columns: string[];
  rows: number;
  source: string;
}

export class SqliteStore implements DataStore {
  private db: DatabaseSync;
  private tables = new Map<string, TableInfo>();
  private counter = 0;

  constructor() {
    // getBuiltinModule keeps the bundler from rewriting "node:sqlite" to "sqlite".
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("node:sqlite is unavailable: the TickerDB MCP server needs Node 22.5 or newer.");
    this.db = new sqlite.DatabaseSync(":memory:");
  }

  async autoName(prefix: string): Promise<string> {
    return `${prefix}_${++this.counter}`;
  }

  async begin(name: string, source: string, append = false): Promise<void> {
    checkTableName(name);
    const key = name.toLowerCase();
    const existing = this.tables.get(key);
    if (existing && append) {
      existing.source = source;
      return;
    }
    this.db.exec(`DROP TABLE IF EXISTS ${q(name)}`);
    this.tables.set(key, { name, columns: [], rows: 0, source });
  }

  async insert(name: string, rows: FlatRow[]): Promise<void> {
    if (rows.length === 0) return;
    const info = this.tables.get(name.toLowerCase());
    if (!info) throw new Error(`table ${name} not started`);
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
      this.db.exec(`CREATE TABLE ${q(info.name)} (${added.map(q).join(", ")})`);
      info.columns.push(...added);
    } else {
      for (const col of added) {
        this.db.exec(`ALTER TABLE ${q(info.name)} ADD COLUMN ${q(col)}`);
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
          stmt = this.db.prepare(`INSERT INTO ${q(info.name)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
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

  async summary(name: string): Promise<TableSummary> {
    const info = this.tables.get(name.toLowerCase());
    if (!info || info.columns.length === 0) return { table: info?.name ?? name, row_count: 0, columns: [], sample: [] };
    const cols = info.columns.slice(0, SAMPLE_MAX_COLUMNS);
    const stmt = this.db.prepare(`SELECT ${cols.map(q).join(", ")} FROM ${q(info.name)} LIMIT ${SAMPLE_ROWS}`);
    stmt.setReturnArrays(true);
    const sample = (stmt.all() as unknown as unknown[][]).map((r) => r.map(clip));
    return {
      table: info.name,
      row_count: info.rows,
      columns: info.columns,
      ...(cols.length < info.columns.length ? { sample_columns: cols } : {}),
      sample,
    };
  }

  private describe(name: string): unknown {
    const info = this.tables.get(name.toLowerCase());
    if (!info) throw new Error(`No stored table "${name}". SHOW TABLES lists them.`);
    const columns = info.columns.map((c) => {
      const r = this.db.prepare(`SELECT typeof(${q(c)}) AS t FROM ${q(info.name)} WHERE ${q(c)} IS NOT NULL LIMIT 1`).get() as
        | { t: string }
        | undefined;
      return [c, r?.t ?? "null"];
    });
    return { table: info.name, row_count: info.rows, source: info.source, columns };
  }

  async query(sql: string, opts: QueryOptions): Promise<unknown> {
    const parsed = parseQuery(sql);
    if (parsed.kind === "show") {
      return { tables: [...this.tables.values()].map((t) => ({ table: t.name, rows: t.rows, columns: t.columns.length, source: t.source })) };
    }
    if (parsed.kind === "describe") return this.describe(parsed.table);
    const limit = clampRows(opts.maxRows);

    this.db.exec("PRAGMA query_only = 1");
    try {
      const stmt = this.db.prepare(parsed.text);
      stmt.setReturnArrays(true);
      const columns = stmt.columns().map((c) => c.name);
      const rows: unknown[][] = [];
      let total = 0;
      let fd: number | undefined;
      let fullPath: string | undefined;
      let buf: string[] = [];
      if (opts.outputPath) {
        fullPath = resolve(opts.outputPath);
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
      return queryResult(columns, rows, total, opts.format, fullPath ? { csv_file: fullPath } : {});
    } finally {
      this.db.exec("PRAGMA query_only = 0");
    }
  }
}
