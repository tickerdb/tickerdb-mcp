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
| `get_search` | Search assets by categorical state with filters |
| `get_schema` | Discover available fields and filter options (always free, 0 credits) |
| `get_watchlist` | Live data for your saved watchlist tickers |
| `get_watchlist_changes` | Field-level diffs since the last pipeline run |
| `add_to_watchlist` | Add tickers to your watchlist |
| `remove_from_watchlist` | Remove tickers from your watchlist |
| `get_account` | Account details, plan tier, and usage |
| `create_webhook` | Register a webhook for watchlist changes |
| `list_webhooks` | List registered webhooks |
| `delete_webhook` | Remove a webhook |

All tools are available on every tier (Free, Plus, Pro) â€” tiers differ by rate limits, history depth, and watchlist size. See [tickerdb.com/pricing](https://tickerdb.com/pricing) for details.

Tools remain categorical-first for efficient LLM context. Use `get_ohlcv` when exact daily prices are needed, and follow `next_cursor` while `has_more` is true.
`get_watchlist` does not take a timeframe. Use `get_watchlist_changes` for daily or weekly diffs.
Add `stats=true` in `get_summary` event mode when you want aggregate event-band and aftermath distributions instead of raw rows.
`get_summary` keeps sibling `_meta` / `status_meta` objects off by default; pass `meta: true` when you want paid-tier stability metadata inline, or request explicit `*_meta` field paths. `get_watchlist` still includes paid-tier `_meta` objects by default.

MA distance fields are available throughout the stack:

- Use flat schema/search/event names like `trend_distance_ma8`, `trend_distance_ma20`, `trend_distance_ma50`, `trend_distance_ma100`, and `trend_distance_ma200`.
- Summary snapshots expose nested MA distance bands under `trend.distance_from_ma_band.ma_8` through `ma_200`.
- MA event queries support grouped `band=above` and `band=below` aliases in addition to granular values like `slightly_above`.

## Remote Server

You can also connect directly to the hosted MCP server at `https://mcp.tickerdb.com` with your API key as a Bearer token, without installing this package.

## Documentation

Full API docs and endpoint details at [tickerdb.com/docs](https://tickerdb.com/docs).

