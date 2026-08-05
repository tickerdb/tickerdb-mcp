# TickerDB — Stock market data for agents.

Pre-computed stock market data for AI agents. TickerDB returns indicators like `trend_direction`, `support_level`, and `analyst_consensus` as named states — plus what *changed* and what *usually happens next*.

10,000+ US stocks, ETFs, and crypto pairs · 182 indicators across trend, momentum, volatility, volume, patterns, support/resistance, fundamentals, and sector context · 7 years of history · [tickerdb.com](https://tickerdb.com)

## Tools

| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental snapshot for a ticker. Historical lookups, state transition history, and what usually happens after |
| `get_ohlcv` | Daily or weekly EOD candles for returns, charts, and backtests |
| `get_search` | Screen assets by categorical state or rank by fields like `market_cap` or `pe_ratio` |
| `get_schema` | Discover all 182 fields and their valid band values |
| `get_watchlist` | Full analytical summary for every ticker on your saved watchlist |
| `get_watchlist_changes` | What changed on your watchlist — day-over-day or week-over-week |
| `add_to_watchlist` | Add tickers to your watchlist |
| `remove_from_watchlist` | Remove tickers from your watchlist |
| `get_account` | Account details, plan tier, and usage |

All tools are available on every tier (Free, Plus, Pro). Tiers differ by credit limits, history depth, number of filters, and watchlist size. See [tickerdb.com/pricing](https://tickerdb.com/pricing).

## Quick start

Connect TickerDB to Claude, ChatGPT, or another MCP client (see [Setup](#setup) below), then try:

> **"Show me oversold large-cap stocks near support"**

The agent calls `get_search` with filters for `momentum_rsi_zone = oversold` and `market_cap_tier in [large, mega]`, then follows up with `get_summary` on individual results. No raw number crunching — the agent reads categorical states and reasons over them directly.

> **"What usually happens when AAPL goes oversold?"**

`get_summary` with `field=momentum_rsi_zone`, `band=oversold`, `stats=true` returns aggregate aftermath distributions: how the stock performed 5, 10, 20, 50, and 100 days after each oversold entry over 7 years of history.

> **"What changed on my watchlist?"**

`get_watchlist_changes` returns only the field-level state transitions since the last pipeline run — band entries, exits, and shifts — so the agent reports what moved without pulling full summaries for every ticker.

## Why not just pass raw OHLCV?

A model can compute RSI from raw bars. But ask "Does AAPL look bullish?" with raw OHLCV and it burns its context on arithmetic — computing indicators one by one — instead of doing what you actually asked: noticing that RSI just hit oversold while institutions are accumulating, that the pullback is sharp but the 200-day uptrend is intact, that insiders have been selling all quarter. That's the analysis. Raw bars bury it under computation.

With TickerDB, the model sees `"oversold"`, `"accumulation"`, `"strong_uptrend"` and connects them immediately.

**State transitions** go further. "What happened the last time BTC was this oversold?" means computing RSI across 7 years of daily bars, finding every oversold entry, and calculating what happened after each one. With TickerDB it's one call: `get_summary` with `field=momentum_rsi_zone`, `band=oversold`, `stats=true`.

## Setup

### Hosted server (recommended)

The remote server at `https://mcp.tickerdb.com/mcp` supports OAuth 2.1 and Bearer token auth. Use Streamable HTTP transport (not legacy SSE).

| Client | How |
|---|---|
| Claude.ai | Settings → Connectors → Add → `https://mcp.tickerdb.com/mcp` → Authorize with your TickerDB API key |
| Claude Code | `claude mcp add --transport http --scope user tickerdb https://mcp.tickerdb.com/mcp` |
| ChatGPT | Plugins → Add → `https://mcp.tickerdb.com/mcp` → Authorize with your TickerDB API key |
| Cursor | `.cursor/mcp.json` → `{"tickerdb": {"url": "https://mcp.tickerdb.com/mcp"}}` |
| Any MCP client | Streamable HTTP to `https://mcp.tickerdb.com/mcp` with `Authorization: Bearer tdb_...` |

### npm package (local stdio)

For clients that prefer a local process (Claude Desktop, etc.):

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

## Structure

Three-package monorepo:

- **`shared/`** — Tool definitions, API client, and server factory (internal)
- **`remote/`** — Cloudflare Worker at `mcp.tickerdb.com` (Streamable HTTP + OAuth 2.1)
- **`local/`** — Published npm package `tickerdb-mcp` (stdio)

Both transports use the same tool definitions. The MCP server is a thin proxy — access control, rate limiting, and field filtering are handled by the TickerDB API.

### Authentication

- **Bearer token** — `Authorization: Bearer tdb_...`
- **OAuth 2.1** — dynamic client registration, PKCE, token exchange, revocation. `/authorize` redirects to tickerdb.com for consent.

Unauthenticated `initialize` and `tools/list` are permitted for tool discovery; `tools/call` requires auth and returns a `401` Bearer challenge with `resource_metadata` for clean re-authorization.

### Session strategy

The remote worker defaults to **stateless transport** — intentionally. All tools are request/response stateless, and Cloudflare Worker memory is isolate-local. Stateless mode avoids edge session loss that can invalidate connector-discovered namespaces. Set `MCP_SESSION_MODE=stateful` for explicit session debugging.

## Development

```bash
npm install                              # workspace dependencies
npm run build                            # type-check remote + shared
npx wrangler dev                         # remote dev server
cd local && npm install && npm run build  # npm package
```

## Deployment

```bash
# Remote server
npx wrangler deploy

# npm + MCP Registry (recommended)
export MCP_PUBLISHER_KEY="your_saved_tickerdb_registry_private_key_hex"
./release.sh mcp patch

# npm only
cd local && npm version patch && npm run build && npm publish
```
