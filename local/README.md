# TickerDB MCP server

Market data for AI trading agents. This server connects Claude, ChatGPT, Cursor or any MCP client to [TickerDB](https://tickerdb.com), so your agent can screen the market, read a stock's state and backtest a trading model.

TickerDB covers 10,000+ US stocks, ETFs and crypto pairs, daily and weekly, with history from 2019. Each value comes as a number and as a named band, including things an agent can't work out from price bars: `pattern_bull_flag_state` is `"mature"`, `fundamentals_valuation_zone` is `"undervalued"`. Every row uses only what was public by its date, so a backtest sees what it would have seen live.

## Setup

This package runs TickerDB as a local process over stdio, for clients that start their own servers (Claude Desktop, Claude Code, Codex, Cursor). Needs Node 22.5 or newer.

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

**Prefer not to run a local process?** Connect to the hosted server at `https://mcp.tickerdb.com/mcp`: sign in and click Allow, no install and no API key. See the [MCP docs](https://tickerdb.com/docs/mcp).

## Try it

> **"Which stocks are forming a bull flag while their insiders are buying?"**

The agent looks up the field names with `get_schema`, then calls `query` with two filters: `pattern_bull_flag_state = mature`, and `insider_cluster_buying_state = cluster` (three or more insiders bought on the open market in the last 30 days). The filtering happens on the server, so only the matches reach the agent. It can follow up with `get_summary` on any of them.

> **"When has NVDA started a new uptrend?"**

`get_summary` with `timeframe=weekly`, `field=trend_stage` and `band=stage_2_growth` returns each time it happened: the date, the stage NVDA left, and how long it had been there. Add `stats=true` to get how often each stage was entered.

> **"Test a rule: each week, buy the 20 cheapest S&P 500 stocks by P/E. Since 2019."**

`query` with `fields=["fundamentals_pe_ratio"]`, `member_of=sp500`, `start`/`end`, `ohlcv=true`, `store_as=rule` and `fetch_all=true` pulls the whole history into a table in one call. Each row has the P/E and the index's members as they were known that week, so the test sees what it would have seen then. The agent runs the test with SQL in `query_data`, and the hundreds of thousands of rows stay out of its context. How far back you can go depends on your plan.

## Tools

Eight tools. Field lists live in `get_schema`, and the less common endpoints sit behind `search_tools` and `call_tool`, which keeps the tool list short.

| Tool | What it does |
|---|---|
| `get_schema` | Looks up field names, units and band values: `search="rsi zone"`, `category=patterns`, `level=market` (or `level=model`) |
| `query` | Any cross-section or history. One date with filters, tickers, a sort or a limit is a ranked screen (`/v1/search`). One date with only fields is every asset (`/v1/universe`). `start` and `end` is every row in the range (`/v1/history`, weekly by default past about 6 months) |
| `get_summary` | One ticker: its latest snapshot, one date, a series, or each time a band was entered (`field`, `band`, `stats=true`) |
| `get_market` | Market (`market_*`) and economy (`macro_*`) regime rows, one per date, and the dates a regime changed |
| `get_ohlcv` | Daily or weekly end-of-day candles |
| `search_tools` | Finds the other endpoints and their parameters: changes, insiders, insider trades and holdings, funds, fund holdings and holders, indexes, index members, TickerDB's own trading models, status, account, and the raw search and universe routes |
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

## Documentation

Endpoints, fields and data quality are documented at [tickerdb.com/docs](https://tickerdb.com/docs). The source is at [github.com/tickerdb/tickerdb-mcp](https://github.com/tickerdb/tickerdb-mcp).
