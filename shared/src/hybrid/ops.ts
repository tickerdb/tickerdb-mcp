// Every API route as one operation: how to call it, where its rows are, how it pages.
// First-class tools and call_tool both run through these.

type Args = Record<string, unknown>;
type Query = Record<string, string | undefined>;
type Row = Record<string, unknown>;

export interface ParamSpec {
  type: string; // shown to the agent: string, integer, boolean, string[], or a|b|c
  required?: boolean;
  desc?: string;
}

export interface Op {
  name: string;
  /** The /v1 route this op calls, as the website names its file: /funds/holders, /summary/[ticker]. */
  apiRoute?: string;
  /** Long-tail ops only: one line for search_tools. */
  purpose?: string;
  /** Long-tail ops only: parameters for search_tools and call_tool validation. */
  params?: Record<string, ParamSpec>;
  request(args: Args): { path: string; query: Query; body?: Record<string, unknown> };
  /** Routing ops (query): pick the concrete op and its args for this call. Throws on bad input. */
  resolve?(args: Args): { op: Op; args: Args };
  /** Filters the MCP server applies to each page's rows (the route cannot). */
  localFilter?(rows: unknown[]): unknown[];
  /** Which API route served the call, echoed in the result. */
  route?: string;
  /** Where the rows are in the response. */
  rows?: (data: any) => unknown[] | undefined;
  /** How fetch_all follows pages. */
  paging?: "offset" | "offset_full" | "cursor" | "date" | "tokens";
  /** Page size fetch_all asks for when the caller gave no limit. */
  maxLimit?: number;
  /** Response-level values copied onto each stored row (e.g. ohlcv bars carry no ticker). */
  hoist?(data: any, args: Args): Row;
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
const upper = (v: unknown) => str(v)?.trim().toUpperCase();
const lower = (v: unknown) => str(v)?.trim().toLowerCase();
const json = (v: unknown) => (v === undefined || v === null ? undefined : typeof v === "string" ? v : JSON.stringify(v));

const ROW_KEYS = ["rows", "results", "bars", "trades", "insiders", "funds", "holdings", "members", "indexes", "events", "fields"];

/** Default row finder: a known array key, else the first array of objects. */
export function findRows(data: any): unknown[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  for (const k of ROW_KEYS) if (Array.isArray(data[k])) return data[k];
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v;
  }
  return undefined;
}

export const OPS: Record<string, Op> = {
  get_schema: {
    name: "get_schema",
    apiRoute: "/schema/fields",
    request: (a) => ({
      path: "/schema/fields",
      query: { search: str(a.search), category: str(a.category), level: str(a.level), compact: str(a.compact), markers: str(a.markers) },
    }),
  },
  get_search: {
    name: "get_search",
    apiRoute: "/search",
    purpose: "Raw /v1/search: filter and rank assets on one date (or a date range with a market_/macro_ filter). The query tool routes here for you.",
    params: {
      filters: { type: "string", required: true, desc: "JSON array of {field, op, value}" },
      fields: { type: "string", desc: "JSON array" },
      sort_by: { type: "string" },
      sort_direction: { type: "asc|desc" },
      timeframe: { type: "daily|weekly" },
      date: { type: "YYYY-MM-DD" },
      start: { type: "YYYY-MM-DD" },
      end: { type: "YYYY-MM-DD" },
      limit: { type: "integer", desc: "max 500" },
      offset: { type: "integer" },
      member_of: { type: "string" },
      held_by: { type: "string" },
    },
    request: (a) => ({
      path: "/search",
      query: {
        filters: json(a.filters),
        fields: json(a.fields),
        sort_by: str(a.sort_by),
        sort_direction: str(a.sort_direction),
        timeframe: str(a.timeframe),
        date: str(a.date),
        start: str(a.start),
        end: str(a.end),
        limit: str(a.limit),
        offset: str(a.offset),
        member_of: str(a.member_of),
        held_by: str(a.held_by),
      },
    }),
  },
  get_summary: {
    name: "get_summary",
    apiRoute: "/summary/[ticker]",
    request: (a) => ({
      path: `/summary/${encodeURIComponent(upper(a.ticker) ?? "")}`,
      query: {
        timeframe: str(a.timeframe),
        date: str(a.date),
        start: str(a.start),
        end: str(a.end),
        fields: json(a.fields),
        meta: str(a.meta),
        sample: str(a.sample),
        field: str(a.field),
        band: str(a.band),
        limit: str(a.limit),
        before: str(a.before),
        after: str(a.after),
        stats: str(a.stats),
        context_ticker: upper(a.context_ticker),
        context_field: str(a.context_field),
        context_band: str(a.context_band),
        adjustment: str(a.adjustment),
      },
    }),
    rows: (d) => (Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.events) ? d.events : undefined),
    hoist: (d) => ({ ticker: d?.ticker }),
  },
  get_universe: {
    name: "get_universe",
    apiRoute: "/universe",
    purpose: "Raw /v1/universe: selected fields (max 60) for every asset on one date. The query tool routes here for you.",
    params: {
      fields: { type: "string[]", required: true },
      date: { type: "YYYY-MM-DD" },
      timeframe: { type: "daily|weekly" },
      asset_class: { type: "stock|etf|crypto" },
      member_of: { type: "string" },
      held_by: { type: "string" },
    },
    request: (a) => ({
      path: "/universe",
      query: {
        fields: json(a.fields),
        date: str(a.date),
        timeframe: str(a.timeframe),
        asset_class: str(a.asset_class),
        member_of: str(a.member_of),
        held_by: str(a.held_by),
      },
    }),
  },
  get_market: {
    name: "get_market",
    apiRoute: "/market",
    request: (a) => ({
      path: "/market",
      query: {
        fields: json(a.fields),
        filters: json(a.filters),
        changes: json(a.changes),
        timeframe: str(a.timeframe),
        date: str(a.date),
        start: str(a.start),
        end: str(a.end),
        order: str(a.order),
        limit: str(a.limit),
      },
    }),
    paging: "date",
    maxLimit: 2000,
  },
  get_ohlcv: {
    name: "get_ohlcv",
    apiRoute: "/ohlcv/[ticker]",
    request: (a) => ({
      path: `/ohlcv/${encodeURIComponent(upper(a.ticker) ?? "")}`,
      query: {
        timeframe: str(a.timeframe),
        start: str(a.start),
        end: str(a.end),
        limit: str(a.limit),
        order: str(a.order),
        cursor: str(a.cursor),
        adjustment: str(a.adjustment),
      },
    }),
    paging: "cursor",
    maxLimit: 1000,
    hoist: (d) => ({ ticker: d?.ticker }),
  },

  // ---- Long tail: reached through search_tools / call_tool ----
  get_changes: {
    name: "get_changes",
    apiRoute: "/changes",
    purpose: "Band changes on the newest date (day-over-day or week-over-week) for up to 50 tickers; one row per ticker and changed field.",
    params: {
      tickers: { type: "string[]", required: true, desc: "up to 50" },
      timeframe: { type: "daily|weekly" },
    },
    request: (a) => ({
      path: "/changes",
      query: {
        tickers: Array.isArray(a.tickers) ? a.tickers.map((t) => String(t).trim().toUpperCase()).join(",") : upper(a.tickers),
        timeframe: str(a.timeframe),
      },
    }),
    rows: (d) => {
      if (!d?.changes || typeof d.changes !== "object") return undefined;
      return Object.entries(d.changes as Record<string, unknown[]>).flatMap(([ticker, list]) =>
        (Array.isArray(list) ? list : []).map((c) => ({ ticker, ...(c as Row) })),
      );
    },
  },
  get_insiders: {
    name: "get_insiders",
    apiRoute: "/insiders",
    purpose: "Find insiders (Form 4 officers, directors and 10% owners, 13F managers, Members of Congress) by loose name search, ticker, type, role or source; gives the slug for get_insider_trades and get_insider_holdings.",
    params: {
      q: { type: "string", desc: "name, e.g. jeff bezos" },
      ticker: { type: "string" },
      type: { type: "person|organization" },
      role: {
        type: "ceo|cfo|coo|president|chair|officer|director|ten_percent_owner|politician|member_house|member_senate|congress_filer|thirteen_f_manager|hedge_fund|private_equity|venture_capital|real_estate_fund|liquidity_fund|securitized_asset_fund|other_private_fund",
      },
      source: { type: "form4|13f|congress" },
      active_since: { type: "YYYY-MM-DD" },
      limit: { type: "integer", desc: "max 100" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/insiders",
      query: { q: str(a.q), ticker: upper(a.ticker), type: str(a.type), role: str(a.role), source: str(a.source), active_since: str(a.active_since), limit: str(a.limit), offset: str(a.offset) },
    }),
    paging: "offset",
    maxLimit: 100,
  },
  get_insider_trades: {
    name: "get_insider_trades",
    apiRoute: "/insiders/trades",
    purpose: "One insider's disclosed trades (Form 4, Congress) by disclosure time. Backtests act at disclosed_at, never trade_date; open_market_only drops grants/exercises/gifts.",
    params: {
      insider: { type: "string", required: true, desc: "slug from get_insiders" },
      start: { type: "YYYY-MM-DD" },
      end: { type: "YYYY-MM-DD" },
      ticker: { type: "string" },
      open_market_only: { type: "boolean" },
      exclude_planned: { type: "boolean", desc: "drop Rule 10b5-1 trades" },
      owner: { type: "self|SP|JT|DC", desc: "Congress: self, spouse, joint, child" },
      exclude_options: { type: "boolean", desc: "Congress: drop option lines" },
      order: { type: "asc|desc" },
      limit: { type: "integer", desc: "max 500" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/insiders/trades",
      query: {
        insider: lower(a.insider),
        start: str(a.start),
        end: str(a.end),
        ticker: upper(a.ticker),
        open_market_only: str(a.open_market_only),
        exclude_planned: str(a.exclude_planned),
        owner: str(a.owner),
        exclude_options: str(a.exclude_options),
        order: str(a.order),
        limit: str(a.limit),
        offset: str(a.offset),
      },
    }),
    paging: "offset",
    maxLimit: 500,
    hoist: (d) => ({ insider: d?.insider?.slug }),
  },
  get_insider_holdings: {
    name: "get_insider_holdings",
    apiRoute: "/insiders/holdings",
    purpose: "What an insider's disclosures say they hold on a date, point in time by filing date: 13F positions; Form 4 shares last stated (after a trade, or on a Form 3/4/5 holding row); Congress: the last annual report's rows (stated) beside what trades since imply (never netted, not a portfolio). basis and reported_by_filer say which.",
    params: {
      insider: { type: "string", required: true, desc: "slug from get_insiders" },
      date: { type: "YYYY-MM-DD" },
      source: { type: "13f|form4|congress" },
      ticker: { type: "string" },
      owner: { type: "self|SP|JT|DC", desc: "Congress" },
      include_closed: { type: "boolean" },
      limit: { type: "integer", desc: "max 1000" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/insiders/holdings",
      query: {
        insider: lower(a.insider),
        date: str(a.date),
        source: str(a.source),
        ticker: upper(a.ticker),
        owner: str(a.owner),
        include_closed: str(a.include_closed),
        limit: str(a.limit),
        offset: str(a.offset),
      },
    }),
    paging: "offset",
    maxLimit: 1000,
    hoist: (d, a) => ({ insider: d?.insider?.slug ?? lower(a.insider) }),
  },
  get_funds: {
    name: "get_funds",
    apiRoute: "/funds",
    purpose: "Find ETFs and mutual funds that file SEC N-PORT holdings, by name words or ticker; largest first.",
    params: {
      q: { type: "string" },
      ticker: { type: "string", desc: "fund ticker or SEC series id" },
      etf_only: { type: "boolean" },
      limit: { type: "integer", desc: "max 100" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/funds",
      query: { q: str(a.q), ticker: upper(a.ticker), etf_only: str(a.etf_only), limit: str(a.limit), offset: str(a.offset) },
    }),
    paging: "offset",
    maxLimit: 100,
  },
  get_fund_holdings: {
    name: "get_fund_holdings",
    apiRoute: "/funds/holdings",
    purpose: "A fund's full N-PORT portfolio as public on a date (point in time by filing date), largest first.",
    params: {
      fund: { type: "string", required: true, desc: "fund ticker or SEC series id" },
      date: { type: "YYYY-MM-DD" },
      limit: { type: "integer", desc: "max 5000" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/funds/holdings",
      query: { fund: upper(a.fund), date: str(a.date), limit: str(a.limit), offset: str(a.offset) },
    }),
    paging: "offset",
    maxLimit: 5000,
    hoist: (_d, a) => ({ fund: upper(a.fund) }),
  },
  get_fund_holders: {
    name: "get_fund_holders",
    apiRoute: "/funds/holders",
    purpose: "Which funds held a stock on a date (N-PORT, point in time), largest first, plus its tracked index memberships.",
    params: {
      ticker: { type: "string", required: true },
      date: { type: "YYYY-MM-DD" },
      etf_only: { type: "boolean" },
      limit: { type: "integer", desc: "max 1000" },
      offset: { type: "integer" },
    },
    request: (a) => ({
      path: "/funds/holders",
      query: { ticker: upper(a.ticker), date: str(a.date), etf_only: str(a.etf_only), limit: str(a.limit), offset: str(a.offset) },
    }),
    paging: "offset",
    maxLimit: 1000,
  },
  get_indexes: {
    name: "get_indexes",
    apiRoute: "/indexes",
    purpose: "Tracked indexes (sp500, sp400, sp600, sp100, nasdaq100, russell1000, russell2000), their source funds and member counts.",
    params: {},
    request: () => ({ path: "/indexes", query: {} }),
  },
  get_index_members: {
    name: "get_index_members",
    apiRoute: "/indexes/members",
    purpose: "An index's members on a date, point in time (tracking fund's newest N-PORT filed by then). To screen members use member_of on query.",
    params: {
      index: { type: "string", required: true, desc: "e.g. sp500" },
      date: { type: "YYYY-MM-DD" },
    },
    request: (a) => ({ path: "/indexes/members", query: { index: lower(a.index), date: str(a.date) } }),
    hoist: (d) => ({ index: d?.index, date: d?.date }),
  },
  get_status: {
    name: "get_status",
    apiRoute: "/status",
    purpose: "Free: newest published daily/weekly dates per asset class, preliminary or final, and the release schedule.",
    params: {},
    request: () => ({ path: "/status", query: {} }),
  },
  get_account: {
    name: "get_account",
    apiRoute: "/account",
    purpose: "Your plan tier, credit limits and usage.",
    params: {},
    request: () => ({ path: "/account", query: {} }),
  },
};

export const LONG_TAIL = Object.values(OPS).filter((op) => op.params);

/** Validate and coerce call_tool params against an op's spec. */
export function checkParams(op: Op, params: Args): Args {
  const spec = op.params ?? {};
  const unknown = Object.keys(params).filter((k) => !(k in spec));
  if (unknown.length) {
    throw new Error(`${op.name}: unknown param(s) ${unknown.join(", ")}. Valid: ${Object.keys(spec).join(", ") || "none"}.`);
  }
  const out: Args = {};
  for (const [k, s] of Object.entries(spec)) {
    let v = params[k];
    if (v === undefined || v === null || v === "") {
      if (s.required) throw new Error(`${op.name}: ${k} is required.`);
      continue;
    }
    if (s.type === "integer") {
      const n = Number(v);
      if (!Number.isInteger(n)) throw new Error(`${op.name}: ${k} must be an integer.`);
      v = n;
    } else if (s.type === "boolean") {
      if (typeof v === "string") v = v === "true";
      v = Boolean(v);
    } else if (s.type === "string[]") {
      if (typeof v === "string") v = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (!Array.isArray(v)) throw new Error(`${op.name}: ${k} must be an array of strings.`);
    } else if (s.type.includes("|") && !s.type.startsWith("YYYY")) {
      const allowed = s.type.split("|");
      if (!allowed.includes(String(v))) throw new Error(`${op.name}: ${k} must be one of ${allowed.join(", ")}.`);
    }
    out[k] = v;
  }
  return out;
}

export function describeOp(op: Op): string {
  const params = Object.entries(op.params ?? {})
    .map(([k, s]) => `${k}${s.required ? "*" : ""}: ${s.type}${s.desc ? ` (${s.desc})` : ""}`)
    .join("; ");
  const paging = op.paging ? " Pages: fetch_all." : "";
  return `${op.name}: ${op.purpose}${paging}\n  params: ${params || "none"}`;
}

export function searchOps(query: string): Op[] {
  const words = query.toLowerCase().split(/[\s_,/]+/).filter(Boolean);
  if (words.length === 0) return LONG_TAIL;
  const scored = LONG_TAIL.map((op) => {
    const hay = `${op.name} ${op.purpose} ${Object.keys(op.params ?? {}).join(" ")}`.toLowerCase().replace(/_/g, " ");
    const name = op.name.replace(/_/g, " ");
    const has = (s: string, w: string) => s.includes(w) || s.includes(w.replace(/s$/, ""));
    const hits = words.filter((w) => has(hay, w)).length;
    if (hits === 0) return { op, hits };
    // Name matches rank first: "insider trades" -> get_insider_trades before get_insiders.
    return { op, hits: hits + 2 * words.filter((w) => has(name, w)).length };
  }).filter((x) => x.hits > 0);
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((x) => x.op);
}
