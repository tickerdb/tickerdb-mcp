# TickerDB - Market context for agents.

Connect your agent to pre-computed market context that improves reasoning and reduces token usage.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and any MCP-compatible client.

## Setup

Add to your Claude Desktop config (`claude_desktop_config.json`):

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

## Available Tools

| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker (supports date range, events filtering, and MA distance lookbacks) |
| `get_ohlcv` | Paginated daily EOD candles for exact returns, charts, and backtests |
| `get_search` | Search assets by categorical state or rank snapshots by fields such as `market_cap` |
| `get_schema` | Discover available fields and filter options (always free, 0 credits) |
| `get_watchlist` | Live data for your saved watchlist tickers |
| `get_watchlist_changes` | Field-level diffs since the last pipeline run |
| `add_to_watchlist` | Add tickers to your watchlist |
| `remove_from_watchlist` | Remove tickers from your watchlist |
| `get_account` | Account details, plan tier, and usage |
| `create_webhook` | Register a webhook for watchlist changes |
| `list_webhooks` | List registered webhooks |
| `delete_webhook` | Remove a webhook |

All tools are available on every tier (Free, Plus, Pro, Business). Tiers differ by credit limits, history depth, watchlist size, and webhook capacity. Business limits are per seat. See [tickerdb.com/pricing](https://tickerdb.com/pricing) for details.

Tools remain categorical-first for efficient LLM context. `get_summary` includes the same-candle `ohlcv.open/high/low/close/volume`, pattern setup states under `patterns.bull_flag`, `patterns.bear_flag`, triangle fields, wedge fields, and stock-only fundamentals such as `fundamentals.free_cash_flow`; use `get_ohlcv` when exact multi-bar daily history is needed, and follow `next_cursor` while `has_more` is true. OHLCV costs 1 credit per 100 bars returned, rounded up, with a 1 credit minimum.
`get_watchlist` does not take a timeframe. Use `get_watchlist_changes` for daily or weekly diffs.
Add `stats=true` in `get_summary` event mode when you want aggregate event-band and aftermath distributions instead of raw rows.
Paid event aftermaths include exact close-to-close fields such as `return_5d_pct`, `return_20d_pct`, and `return_100d_pct` alongside the categorical performance bands. Incomplete horizons return `null`.
`get_summary` keeps sibling `_meta` / `status_meta` objects off by default; pass `meta: true` when you want paid-tier stability metadata inline, or request explicit `*_meta` field paths. `get_watchlist` still includes paid-tier `_meta` objects by default.

MA distance fields are available throughout the stack:

- Use flat schema/search/event names like `ma8`, `ma20`, `ma40`, `ma50`, `ma100`, `ma200`, `pattern_bull_flag`, `pattern_bear_flag`, `pattern_ascending_triangle`, `pattern_descending_triangle`, `pattern_symmetrical_triangle`, `pattern_rising_wedge`, `pattern_falling_wedge`, `trend_ma_crossover_event`, `trend_ma20_slope`, `trend_ma50_slope`, `trend_distance_ma8`, `trend_distance_ma20`, `trend_distance_ma40`, `trend_distance_ma50`, `trend_distance_ma100`, and `trend_distance_ma200`.
- Summary snapshots expose nested MA distance bands under `trend.distance_from_ma_band.ma_8` through `ma_200`, MA slope states under `trend.ma_slopes.ma_8` through `ma_200`, plus `trend.ma_compression_band` and `trend.ma_crossover_event`.
- MA distance event queries support grouped `band=above` and `band=below` aliases in addition to granular values like `proximity_above`.

Fundamental bands follow the same naming pattern: use `fundamentals.free_cash_flow` in summary field selection and `fundamentals_free_cash_flow` in schema, search, watchlist change, and event queries.

## Remote Server

You can also connect directly to the hosted MCP server at `https://mcp.tickerdb.com` with your API key as a Bearer token, without installing this package.

## Documentation

Full API docs and endpoint details at [tickerdb.com/docs](https://tickerdb.com/docs).

