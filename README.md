# TickerDB MCP server

Market data for AI trading agents. This server connects Claude, ChatGPT, Cursor or any MCP client to [TickerDB](https://tickerdb.com), so your agent can screen the market, read a stock's state and backtest a trading model.

TickerDB covers 10,000+ US stocks, ETFs and crypto pairs, daily and weekly, with history from 2019. Each value comes as a number and as a named band, including things an agent can't work out from price bars: `pattern_bull_flag_state` is `"mature"`, `fundamentals_valuation_zone` is `"undervalued"`. Every row uses only what was public by its date, so a backtest sees what it would have seen live.

## Connect

### Hosted server

Add `https://mcp.tickerdb.com/mcp` to your client. A TickerDB page opens in your browser: sign in and click **Allow**. You don't need an API key, and a free account works.

| Client | How |
|---|---|
| Claude (web and Desktop) | Settings → Connectors → **+** → Add custom connector → enter the URL → Add → Connect |
| Claude Code | `claude mcp add --transport http --scope user tickerdb https://mcp.tickerdb.com/mcp`, then `/mcp` and select TickerDB |
| ChatGPT | Plugins → **+** → enter the URL → Create |
| Cursor | In `.cursor/mcp.json`: `{"mcpServers": {"tickerdb": {"url": "https://mcp.tickerdb.com/mcp"}}}` |
| Any other client | Streamable HTTP transport (not legacy SSE) with the URL above |
| An agent with no browser | Send your API key as a header: `Authorization: Bearer tdb_...` |

Step-by-step instructions for each client are in the [MCP docs](https://tickerdb.com/docs/mcp).

### Local server (npm)

For clients that run a local process over stdio (Claude Desktop, Claude Code, Codex, Cursor). Needs Node 22.5 or newer.

```json
{
  "mcpServers": {
    "tickerdb": {
      "command": "npx",
      "args": ["tickerdb-mcp"]
    }
  }
}
```

**No API key yet?** Ask your agent to follow [tickerdb.com/setup](https://tickerdb.com/setup). It gets a free key by device login and saves it where the server looks, so the config above needs no `env` block. The server starts without a key and looks again on each call, so you don't need to restart it.

**Where the server looks for a key**, in order:

1. the `TICKERDB_API_KEY` environment variable;
2. a `TICKERDB_API_KEY=` line in the `.env` of the directory the server runs in;
3. the config file written by device login, `{"api_key": "tdb_..."}`:
   - macOS / Linux: `$XDG_CONFIG_HOME/tickerdb/config.json` (default `~/.config/tickerdb/config.json`)
   - Windows: `%APPDATA%\tickerdb\config.json`

To pass a key yourself, add `"env": {"TICKERDB_API_KEY": "tdb_..."}` to the config. The key is never logged.

Optional environment variables:

| Variable | Default | What it does |
|---|---|---|
| `TICKERDB_API_BASE` | `https://api.tickerdb.com/v1` | Points the server at another TickerDB deployment |
| `TICKERDB_FETCH_MAX_PAGES` | 500 | Most pages one `fetch_all` call follows |
| `TICKERDB_FETCH_MAX_ROWS` | 2,000,000 | Most rows one `fetch_all` call stores |
| `TICKERDB_INLINE_MAX_CHARS` | 40,000 | Results longer than this are stored in a table; 0 turns that off |

## Try it

> **"Which stocks are forming a bull flag while their insiders are buying?"**

The agent looks up the field names with `get_schema`, then calls `query` with two filters: `pattern_bull_flag_state = mature`, and `insider_cluster_buying_state = cluster` (three or more insiders bought on the open market in the last 30 days). The filtering happens on the server, so only the matches reach the agent. It can follow up with `get_summary` on any of them.

> **"When has NVDA started a new uptrend?"**

`get_summary` with `timeframe=weekly`, `field=trend_stage` and `band=stage_2_growth` returns each time it happened: the date, the stage NVDA left, and how long it had been there. Add `stats=true` to get how often each stage was entered.

> **"Test a rule: each week, buy the 20 cheapest S&P 500 stocks by P/E. Since 2019."**

`query` with `fields=["fundamentals_pe_ratio"]`, `member_of=sp500`, `start`/`end`, `ohlcv=true`, `store_as=rule` and `fetch_all=true` pulls the whole history into a table in one call. Each row has the P/E and the index's members as they were known that week, so the test sees what it would have seen then. The agent runs the test with SQL in `query_data`, and the hundreds of thousands of rows stay out of its context. How far back you can go depends on your plan.

## Tools

Ten tools. Field lists live in `get_schema`, and the less common endpoints sit behind `search_tools` and `call_tool`, which keeps the tool list short. The two watchlist tools are the only ones that change anything (your account's watchlist).

| Tool | What it does |
|---|---|
| `get_schema` | Looks up field names, units and band values: `search="rsi zone"`, `category=patterns`, `level=market` (or `level=model`) |
| `query` | Any cross-section or history. One date with filters, tickers, a sort or a limit is a ranked screen (`/v1/search`). One date with only fields is every asset (`/v1/universe`). `start` and `end` is every row in the range (`/v1/history`, weekly by default past about 6 months) |
| `get_summary` | One ticker: its latest snapshot, one date, a series, or each time a band was entered (`field`, `band`, `stats=true`) |
| `get_market` | Market (`market_*`) and economy (`macro_*`) regime rows, one per date, and the dates a regime changed |
| `get_ohlcv` | Daily or weekly end-of-day candles |
| `add_watchlist_tickers` | Adds tickers to your watchlist (one per account, the same list as the website's Track buttons). `call_tool` with `get_watchlist_changes` then says what changed for them since your last check: score, upside and downside potential, earnings, big price moves, trend changes, RSI oversold, volume spikes, insider trades, analyst changes, serious 8-K filings and dividend cuts |
| `remove_watchlist_tickers` | Removes tickers from your watchlist |
| `search_tools` | Finds the other endpoints and their parameters: changes, the watchlist and what changed for it, insiders, insider trades and holdings, funds, fund holdings and holders, indexes, index members, TickerDB's own trading models, status, account, and the raw search and universe routes |
| `call_tool` | Runs an endpoint found with `search_tools` |
| `query_data` | Read-only SQL (SQLite) over results saved with `store_as` |

### Large pulls

Every data tool takes `store_as=<table>`, and `fetch_all=true` to follow every page. The rows go into a SQLite table and the tool returns a short summary: row count, columns and five sample rows. Read the table with `query_data` (`SELECT` or `WITH`, `SHOW TABLES`, `DESCRIBE <table>`). It returns at most 200 rows; `format=csv` returns CSV text. A result over 40,000 characters is stored automatically.

Where the tables live:

- **Local server:** in memory, until the process ends. `query_data` also takes `output_path` to write the full result to a CSV file.
- **Hosted server:** in a store per API key, deleted 24 hours after last use.

### Plans

Every plan has every tool, field and timeframe except the [trading model data](#trading-models), which needs Pro or Commercial. Plans differ by credits and by how far back they read: Free reads the last 30 days (250 credits a month), Plus the last 3 years, Pro and Commercial everything from 2019. See [pricing](https://tickerdb.com/pricing).

## Trading models

TickerDB runs trading models of its own and publishes what each holds and how it has performed (the model level, `model_*` fields). Six endpoints read that record. They need a **Pro or Commercial** plan; on Free and Plus they return `403 tier_restricted`. Run them with `call_tool`. `slug` is the model id from `get_models`, for example `garp-core-10`.

| `call_tool` name | Route | Returns |
|---|---|---|
| `get_models` | `/v1/models` | Every model: description, status, newest row, stats per segment. Params: `asset_class`, `filters`, `sort_by`, `order` |
| `get_model` | `/v1/models/{slug}` | One model: rules, newest row with change markers, stats with yearly returns. Param: `slug` |
| `get_model_history` | `/v1/models/{slug}/history` | Rows over time. Params: `slug`, `start`, `end`, `fields`, `order`, `limit` |
| `get_model_holdings` | `/v1/models/{slug}/holdings` | The book on a date: held, entering, exiting. Each held row has `return_zone`, `age_zone`, `weight_zone`, `max_gain_pct`, `max_loss_pct`. Params: `slug`, `date`, `state` |
| `get_model_trades` | `/v1/models/{slug}/trades` | Trades, open and closed, with bands per trade (exit type, outcome, path, result against the benchmark, duration, entry market regime). Params: `slug`, `status`, `segment`, `ticker`, `exit_type`, `outcome_zone`, `path_zone`, `relative_zone`, `duration_zone`, `entry_market_regime_zone`, `start`, `end`, `order`, `limit`, `offset` |
| `get_models_holdings` | `/v1/models/holdings` | Holdings across models, each at its newest date. Params: `ticker`, `asset_class`, `state`, `return_zone`, `weight_zone`, `limit`, `offset` |

Reading the rows:

- **Backtest and live.** `model_segment` on every row says which. A backtest row replays the model's rules over history; a live row is what the model decided on the day. Both current models went live on 2026-11-09. `stats.live` is `null` until two live rows exist.
- **Band filters** take one label or a comma-separated list: `outcome_zone=big_win,win`.
- **Trade percentiles and `duration_zone`** rank a trade against the model's earlier closed trades, and are `null` until 10 exist.
- **Benchmark fields** are `null` for shorts.
- **An open trade** has its entry context and its best and worst return so far.
- **Position bands** are `null` on `entering` rows.

These endpoints report what each model did. They are not investment advice or a recommendation.

## Why bands, and not only raw bars

An agent can compute RSI from price bars. Other things aren't in the bars at all: that three insiders bought last month, what a company's P/E was on a date in 2021 using only what was public then, which stocks were in the S&P 500 that week. And some are in the bars but cost a lot to find, like a bull flag, or a support level that has held four times.

TickerDB has done that work already. The agent reads `pattern_bull_flag_state: "mature"` and starts on the question you asked. The numbers behind each band are there when it needs them.

History works the same way. Finding every time NVDA began an uptrend since 2019 is one `get_summary` call.

## For contributors

### Structure

Three-package monorepo:

- **`shared/`**: tool definitions, endpoint catalog (`shared/src/hybrid/ops.ts`), `query` routing, API client, and server factory (internal)
- **`remote/`**: Cloudflare Worker at `mcp.tickerdb.com` (Streamable HTTP + OAuth 2.1)
- **`local/`**: published npm package `tickerdb-mcp` (stdio)

Both transports use the same tool definitions; only the `store_as` table store differs (`local/src/sqlite-store.ts`, `remote/src/store.ts`). The MCP server is a thin client: access control, rate limiting and field filtering are handled by the TickerDB API.

### Authentication

- **Bearer token:** `Authorization: Bearer tdb_...`
- **OAuth 2.1:** dynamic client registration, PKCE, token exchange, revocation. `/authorize` redirects to tickerdb.com for consent.

Unauthenticated `initialize` and `tools/list` are permitted for tool discovery; `tools/call` requires auth and returns a `401` Bearer challenge with `resource_metadata` for clean re-authorization.

### Session strategy

The remote worker defaults to **stateless transport**. Cloudflare Worker memory is isolate-local, and stateless mode avoids edge session loss that can invalidate connector-discovered namespaces. Set `MCP_SESSION_MODE=stateful` for explicit session debugging. The only state is the `store_as` tables, which live in the `TickerDbStore` Durable Object (binding `TICKERDB_STORE`, SQLite storage, one object per API key, everything deleted by an alarm 24 hours after last use), so they survive across stateless requests.

### Development

```bash
npm install                              # workspace dependencies
npm run build                            # type-check remote + shared
npx wrangler deploy --dry-run --outdir /tmp/mcp-build  # bundle the Worker without deploying
npx wrangler dev                         # remote dev server
cd local && npm install && npm run build  # npm package

# Tests
cd local && npm test                            # stdio server against a stub API
TICKERDB_WEBSITE_DIR=../tickerdb.com npm test   # Worker tests + API parity
```

The parity test (`remote/test/api-parity.test.mjs`) reads the website checkout at `TICKERDB_WEBSITE_DIR` (default `../tickerdb.com`) and fails when a public `/v1` route is not reachable through a first-class tool or `call_tool`, or when a tool's params differ from its route's.

### Deployment

```bash
# Remote server
npx wrangler deploy

# npm + MCP Registry (recommended)
export MCP_PUBLISHER_KEY="your_saved_tickerdb_registry_private_key_hex"
./release.sh mcp patch

# npm only
cd local && npm version patch && npm run build && npm publish
```
