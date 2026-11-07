# TickerDB — Stock market data for agents.

Pre-computed stock market data for AI agents. TickerDB returns indicators like `trend_direction`, `support_level`, and `analyst_consensus` as named states — plus what *changed* and what *usually happens next*.

10,000+ US stocks, ETFs, and crypto pairs · 182 indicators across trend, momentum, volatility, volume, patterns, support/resistance, fundamentals, and sector context · 7 years of history · [tickerdb.com](https://tickerdb.com)

## Setup

Add to your MCP client config:

```json
{
  "mcpServers": {
    "tickerdb": {
      "command": "npx",
      "args": ["tickerdb-mcp"],
      "env": {
        "TICKERDB_KEY": "tdb_your_api_key_here"
      }
    }
  }
}
```

Get an API key at [tickerdb.com/dashboard](https://tickerdb.com/dashboard).

Works with Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP client that supports stdio transport. Needs Node 22.5 or newer (the table store uses `node:sqlite`).

Optional environment: `TICKERDB_API_BASE` points the server at another TickerDB deployment (default `https://api.tickerdb.com/v1`); `TICKERDB_FETCH_MAX_PAGES` (500), `TICKERDB_FETCH_MAX_ROWS` (2,000,000) and `TICKERDB_INLINE_MAX_CHARS` (40,000; 0 = never auto-store) tune `fetch_all` and auto-storing.

> **Prefer not to run a local process?** Connect directly to the hosted server at `https://mcp.tickerdb.com/mcp` with OAuth or Bearer token auth — no install needed. See the [main repo](https://github.com/tickerdb/tickerdb-mcp) for details.

## Tools

Eight tools. Short descriptions keep the tool list small (about 14K characters including the server instructions, down from 43.5K); field lists live in `get_schema`, and the rarer endpoints sit behind `search_tools` / `call_tool`.

| Tool | Description |
|---|---|
| `get_schema` | Look up field names, units and band values: `search="rsi zone"`, `category=patterns`, `level=market` |
| `query` | Any cross-section or history. One date with filters, tickers, a sort or a limit screens and ranks (`/v1/search`); one date with only fields returns every asset (`/v1/universe`); `start`+`end` returns every row in the range (`/v1/history`, weekly by default past ~6 months) |
| `get_summary` | One ticker: latest snapshot, a date, a series, or band events and what usually happens after (`field`, `band`, `stats=true`) |
| `get_market` | Market (`market_*`) and economy (`macro_*`) regime rows, one per date, and regime changes |
| `get_ohlcv` | Daily or weekly EOD candles for returns, charts and backtests |
| `search_tools` | Find the other endpoints and their params: changes, insiders, insider trades and holdings, funds, fund holdings and holders, indexes, index members, status, account, raw search and universe |
| `call_tool` | Run an endpoint found with `search_tools` |
| `query_data` | Read-only SQL (SQLite) over results saved with `store_as` |

**Large pulls stay out of the context.** Every data tool takes `store_as=<table>` (and `fetch_all=true` to follow every page): rows go into a SQLite table and the tool returns a short summary (row count, columns, five sample rows). Read them with `query_data` (`SELECT`/`WITH`, `SHOW TABLES`, `DESCRIBE <table>`; at most 200 rows back, `format=csv` for CSV text). Inline results over 40K characters are stored automatically. Where the tables live:

- **stdio (`npx tickerdb-mcp`)**: in memory for the life of the process; `query_data` also takes `output_path` to write the full result to a CSV file.
- **Hosted (`mcp.tickerdb.com`)**: a SQLite Durable Object per API key, deleted 24 hours after last use. No `output_path`.

All tools are available on every plan; plans differ by credits, history depth and timeframe. See [tickerdb.com/pricing](https://tickerdb.com/pricing).

### Upgrading from 2.x

3.0 replaces the one-tool-per-route list. These tool names are gone: `get_search` and `get_universe` (use `query`, or `call_tool` with the same name for the raw route), and `get_changes`, `get_insiders`, `get_insider_trades`, `get_funds`, `get_fund_holdings`, `get_fund_holders`, `get_indexes`, `get_index_members`, `get_status`, `get_account` (use `call_tool` with the same name; its params are the route's query params). New: `get_insider_holdings` through `call_tool`. `get_schema`, `get_summary`, `get_market` and `get_ohlcv` keep their names.

## Quick start

Connect TickerDB to Claude, ChatGPT, or another MCP client, then try:

> **"Show me oversold large-cap stocks near support"**

The agent looks up the field names with `get_schema`, then calls `query` with filters for `momentum_rsi_zone = oversold` and `market_cap_tier in [large, mega]`, and follows up with `get_summary` on individual results. The filtering happens on the server, not in the agent's context.

> **"What usually happens when AAPL goes oversold?"**

`get_summary` with `field=momentum_rsi_zone`, `band=oversold`, `stats=true` returns aggregate aftermath distributions: how the stock performed 5, 10, 20, 50, and 100 days after each oversold entry over 7 years of history.

> **"Weekly P/E of every S&P 500 stock since 2019"**

`query` with `fields=["fundamentals_pe_ratio"]`, `member_of=sp500`, `start`/`end`, `store_as=pe` and `fetch_all=true` pulls the whole history into a table in one call; the agent then answers with SQL in `query_data` instead of reading hundreds of thousands of rows.

## Why not just pass raw OHLCV?

A model can compute RSI from raw bars. But ask "Does AAPL look bullish?" with raw OHLCV and it burns its context on arithmetic — computing indicators one by one — instead of doing what you actually asked: noticing that RSI just hit oversold while institutions are accumulating, that the pullback is sharp but the 200-day uptrend is intact, that insiders have been selling all quarter. That's the analysis. Raw bars bury it under computation.

With TickerDB, the model sees `"oversold"`, `"accumulation"`, `"strong_uptrend"` and connects them immediately.

**State transitions** go further. "What happened the last time BTC was this oversold?" means computing RSI across 7 years of daily bars, finding every oversold entry, and calculating what happened after each one. With TickerDB it's one call: `get_summary` with `field=momentum_rsi_zone`, `band=oversold`, `stats=true`.

## Documentation

Full API docs, endpoint details, and field reference at [tickerdb.com/docs](https://tickerdb.com/docs).
