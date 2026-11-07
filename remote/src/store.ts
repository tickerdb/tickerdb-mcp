// The Worker's table store for store_as / query_data: one SQLite-backed Durable
// Object per API key (the hosted server is stateless, so there is no MCP session to
// hang tables on). Tables are scratch space: everything is deleted STORE_TTL_MS after
// the last use. Same rules as the stdio store (shared/src/hybrid/store.ts), plus two
// Durable Object limits: at most 100 columns per table (columns past
// MAX_COLUMNS go into one JSON column, _extra) and 100 bound values per statement.
import { DurableObject } from "cloudflare:workers";
import {
  SAMPLE_MAX_COLUMNS,
  SAMPLE_ROWS,
  checkTableName,
  clampRows,
  clip,
  parseQuery,
  queryResult,
  quoteId as q,
  type DataStore,
  type FlatRow,
  type QueryOptions,
  type TableSummary,
} from "../../shared/src/hybrid/store.js";

export const STORE_TTL_MS = 24 * 60 * 60 * 1000;
/** Regular columns per table; the 100th is _extra. */
const MAX_COLUMNS = 99;
const EXTRA = "_extra";
/** Rows per insert RPC (keeps each message well under the RPC size limit). */
const INSERT_CHUNK = 2000;

type Cell = string | number | null;

interface TableInfo {
  key: string;
  name: string;
  columns: string[];
  extra: string[];
  rows: number;
  source: string;
}

class Rollback {
  constructor(readonly result: Record<string, unknown>) {}
}

const cell = (v: unknown): Cell =>
  v === null || v === undefined ? null : typeof v === "bigint" ? Number(v) : typeof v === "number" || typeof v === "string" ? v : String(v);

export class TickerDbStore extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS _tdb_tables (key TEXT PRIMARY KEY, name TEXT NOT NULL, columns TEXT NOT NULL, extra TEXT NOT NULL, rows INTEGER NOT NULL, source TEXT NOT NULL)",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS _tdb_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
  }

  private async touch(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + STORE_TTL_MS);
  }

  /** Idle for STORE_TTL_MS: drop every table. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.ensureSchema();
  }

  private info(name: string): TableInfo | undefined {
    const r = this.sql.exec<Record<string, string | number>>("SELECT * FROM _tdb_tables WHERE key = ?", name.toLowerCase()).toArray()[0];
    if (!r) return undefined;
    return {
      key: String(r.key),
      name: String(r.name),
      columns: JSON.parse(String(r.columns)),
      extra: JSON.parse(String(r.extra)),
      rows: Number(r.rows),
      source: String(r.source),
    };
  }

  private save(t: TableInfo): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO _tdb_tables (key, name, columns, extra, rows, source) VALUES (?, ?, ?, ?, ?, ?)",
      t.key, t.name, JSON.stringify(t.columns), JSON.stringify(t.extra), t.rows, t.source,
    );
  }

  async autoName(prefix: string): Promise<string> {
    await this.touch();
    const n = Number(this.sql.exec<{ v: number }>("INSERT INTO _tdb_meta (k, v) VALUES ('auto', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1 RETURNING v").one().v);
    return `${prefix}_${n}`;
  }

  async begin(name: string, source: string, append = false): Promise<void> {
    checkTableName(name);
    await this.touch();
    const existing = this.info(name);
    if (existing && append) {
      existing.source = source;
      this.save(existing);
      return;
    }
    this.ctx.storage.transactionSync(() => {
      if (existing) this.sql.exec(`DROP TABLE IF EXISTS ${q(existing.name)}`);
      this.sql.exec(`DROP TABLE IF EXISTS ${q(name)}`);
      this.save({ key: name.toLowerCase(), name, columns: [], extra: [], rows: 0, source });
    });
  }

  async insert(name: string, rows: FlatRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.touch();
    const info = this.info(name);
    if (!info) throw new Error(`table ${name} not started`);
    const known = new Set(info.columns.map((c) => c.toLowerCase()));
    const extra = new Set(info.extra.map((c) => c.toLowerCase()));
    const added: string[] = [];
    const addedExtra: string[] = [];
    for (const row of rows) {
      for (const col of Object.keys(row)) {
        const lc = col.toLowerCase();
        if (known.has(lc) || extra.has(lc)) continue;
        if (info.columns.length + added.length < MAX_COLUMNS && lc !== EXTRA) {
          known.add(lc);
          added.push(col);
        } else {
          extra.add(lc);
          addedExtra.push(col);
        }
      }
    }
    this.ctx.storage.transactionSync(() => {
      if (info.columns.length === 0 && added.length > 0) {
        this.sql.exec(`CREATE TABLE ${q(info.name)} (${added.map(q).join(", ")})`);
      } else {
        for (const col of added) this.sql.exec(`ALTER TABLE ${q(info.name)} ADD COLUMN ${q(col)}`);
      }
      info.columns.push(...added);
      if (addedExtra.length > 0 && info.extra.length === 0) {
        if (info.columns.length === 0) this.sql.exec(`CREATE TABLE ${q(info.name)} (${q(EXTRA)})`);
        else this.sql.exec(`ALTER TABLE ${q(info.name)} ADD COLUMN ${q(EXTRA)}`);
      }
      info.extra.push(...addedExtra);

      for (const row of rows) {
        const cols: string[] = [];
        const vals: Cell[] = [];
        let spill: Record<string, unknown> | undefined;
        for (const [k, v] of Object.entries(row)) {
          if (known.has(k.toLowerCase())) {
            cols.push(k);
            vals.push(cell(v));
          } else {
            (spill ??= {})[k] = typeof v === "bigint" ? Number(v) : v;
          }
        }
        if (spill) {
          cols.push(EXTRA);
          vals.push(JSON.stringify(spill));
        }
        if (cols.length === 0) continue;
        this.sql.exec(`INSERT INTO ${q(info.name)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, ...vals);
      }
      info.rows += rows.length;
      this.save(info);
    });
  }

  private allColumns(info: TableInfo): string[] {
    return info.extra.length ? [...info.columns, EXTRA] : info.columns;
  }

  async summary(name: string): Promise<TableSummary> {
    await this.touch();
    const info = this.info(name);
    const columns = info ? this.allColumns(info) : [];
    if (!info || columns.length === 0) return { table: info?.name ?? name, row_count: 0, columns: [], sample: [] };
    const cols = columns.slice(0, SAMPLE_MAX_COLUMNS);
    const sample = [...this.sql.exec(`SELECT ${cols.map(q).join(", ")} FROM ${q(info.name)} LIMIT ${SAMPLE_ROWS}`).raw()].map((r) => r.map(clip));
    return {
      table: info.name,
      row_count: info.rows,
      columns,
      ...(cols.length < columns.length ? { sample_columns: cols } : {}),
      sample,
      ...(info.extra.length ? { extra_columns: info.extra } : {}),
    };
  }

  async query(sql: string, opts: QueryOptions): Promise<Record<string, unknown>> {
    await this.touch();
    const parsed = parseQuery(sql);
    if (parsed.kind === "show") {
      const tables = this.sql
        .exec<Record<string, string | number>>("SELECT name, rows, columns, extra, source FROM _tdb_tables ORDER BY name")
        .toArray()
        .map((t) => ({
          table: t.name,
          rows: t.rows,
          columns: JSON.parse(String(t.columns)).length + (JSON.parse(String(t.extra)).length ? 1 : 0),
          source: t.source,
        }));
      return { tables };
    }
    if (parsed.kind === "describe") {
      const info = this.info(parsed.table);
      if (!info) throw new Error(`No stored table "${parsed.table}". SHOW TABLES lists them.`);
      const columns = this.allColumns(info).map((c) => {
        const r = this.sql.exec<{ t: string }>(`SELECT typeof(${q(c)}) AS t FROM ${q(info.name)} WHERE ${q(c)} IS NOT NULL LIMIT 1`).toArray()[0];
        return [c, r?.t ?? "null"];
      });
      return {
        table: info.name,
        row_count: info.rows,
        source: info.source,
        columns,
        ...(info.extra.length ? { extra_columns: info.extra, note: "extra_columns are in _extra as JSON: json_extract(_extra, '$.name')" } : {}),
      };
    }
    const limit = clampRows(opts.maxRows);
    // Durable Objects have no query_only pragma: run the statement in a transaction
    // and always roll it back, so even WITH ... DELETE changes nothing.
    try {
      this.ctx.storage.transactionSync(() => {
        const cursor = this.sql.exec(parsed.text);
        const rows: unknown[][] = [];
        let total = 0;
        for (const r of cursor.raw()) {
          total += 1;
          if (rows.length < limit) rows.push(r);
        }
        throw new Rollback(queryResult(cursor.columnNames, rows, total, opts.format));
      });
    } catch (e) {
      if (e instanceof Rollback) return e.result;
      throw e;
    }
    throw new Error("query did not run");
  }
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The Worker's DataStore: forwards to this API key's TickerDbStore. */
export class RemoteStore implements DataStore {
  private stub?: DurableObjectStub<TickerDbStore>;

  constructor(
    private readonly ns: DurableObjectNamespace<TickerDbStore>,
    private readonly apiKey: string,
  ) {}

  private async get(): Promise<DurableObjectStub<TickerDbStore>> {
    if (!this.stub) this.stub = this.ns.get(this.ns.idFromName(`store:${await sha256Hex(this.apiKey)}`));
    return this.stub;
  }

  async autoName(prefix: string): Promise<string> {
    return (await this.get()).autoName(prefix);
  }

  async begin(name: string, source: string, append?: boolean): Promise<void> {
    await (await this.get()).begin(name, source, append);
  }

  async insert(name: string, rows: FlatRow[]): Promise<void> {
    const stub = await this.get();
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) await stub.insert(name, rows.slice(i, i + INSERT_CHUNK));
  }

  async summary(name: string): Promise<TableSummary> {
    return (await (await this.get()).summary(name)) as TableSummary;
  }

  async query(sql: string, opts: QueryOptions): Promise<unknown> {
    return (await this.get()).query(sql, { maxRows: opts.maxRows, format: opts.format });
  }
}
