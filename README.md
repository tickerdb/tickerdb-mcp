# TickerDB - Pre-computed market data for agents.

Connect your agent to pre-computed market context that improves reasoning and reduces token usage.

Connect your agent to hundreds of indicators like trend_direction, support_level, and analyst_consensus to improve reasoning and reduce token usage.

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

All tools are available on every tier (Free, Plus, Pro) â€” tiers differ by credit limits, history depth, and watchlist size. See [tickerdb.com/pricing](https://tickerdb.com/pricing) for details.

Use `get_summary` with `start`/`end` params for bulk ticker syncs across a date range, or with `field`/`band` params to query event occurrences. Add `stats=true` in event mode when you want aggregate event-band and aftermath distributions instead of raw rows.
Paid event aftermaths include exact close-to-close fields such as `return_5d_pct`, `return_20d_pct`, and `return_100d_pct` alongside the categorical performance bands. Incomplete horizons return `null`.
Use `get_ohlcv` when exact multi-bar daily history is required. `get_summary` includes the same-candle `ohlcv` object for the requested snapshot; follow `next_cursor` in `get_ohlcv` while `has_more` is true to retrieve additional bars. OHLCV costs 1 credit per 100 bars returned, rounded up, with a 1 credit minimum.
`get_watchlist` does not take a timeframe. Use `get_watchlist_changes` for daily or weekly diffs.

Current summary snapshots also expose top-level freshness via `as_of_date`, same-candle `ohlcv.open/high/low/close/volume`, stock `market_cap` / `market_cap_tier` when available, pattern setup states under `patterns.bull_flag`, `patterns.bull_flag_breakout`, `patterns.bear_flag`, `patterns.bear_flag_breakdown`, `patterns.ascending_triangle`, `patterns.descending_triangle`, `patterns.symmetrical_triangle`, `patterns.rising_wedge`, and `patterns.falling_wedge`, richer `volume` fields such as `price_direction_on_volume`, opt-in paid-tier level metadata like `support_level.status_meta`, Pro `sector_context` fields such as `agreement` and `overbought_count`, and stock-only fundamentals such as `fundamentals.free_cash_flow` and nested `fundamentals.insider_activity` when available.

MA distance fields are available throughout the stack:

- Use flat schema/search names like `ma8`, `ma20`, `ma40`, `ma50`, `ma100`, `ma200`, `pattern_bull_flag`, `pattern_bull_flag_breakout`, `pattern_bear_flag`, `pattern_bear_flag_breakdown`, `pattern_ascending_triangle`, `pattern_descending_triangle`, `pattern_symmetrical_triangle`, `pattern_rising_wedge`, `pattern_falling_wedge`, `trend_ma50_slope`, `trend_ma_crossover_event`, `trend_distance_ma8`, `trend_distance_ma20`, `trend_distance_ma40`, `trend_distance_ma50`, `trend_distance_ma100`, and `trend_distance_ma200`.
- Summary snapshots expose nested MA slopes under `trend.ma_slopes.ma_8` through `ma_200`, nested MA distance bands under `trend.distance_from_ma_band.ma_8` through `ma_200`, plus `trend.ma_compression_band` and `trend.ma_crossover_event`.
- MA distance event queries support grouped `band=above` and `band=below` aliases in addition to granular values like `proximity_above`.

Fundamental bands follow the same naming pattern: use `fundamentals.free_cash_flow` in summary field selection and `fundamentals_free_cash_flow` in schema, search, watchlist change, and event queries.

### Band Stability Metadata

`get_summary` keeps sibling `_meta` objects off by default so the primary band label stays front-and-center. Pass `meta: true` to include full paid-tier stability metadata across the response, or request just the specific `*_meta` fields you want. `get_watchlist` still includes paid-tier `_meta` objects by default, and `get_watchlist_changes` returns stability fields inline on each change object.

The stability label is one of `fresh`, `holding`, `established`, or `volatile`. Full metadata includes `periods_in_current_state`, `flips_recent`, and `flips_lookback`, which helps agents distinguish between a newly entered state and one that has persisted for many periods.

## Setup

### Option 1: Claude.ai (OAuth)

The remote server at `mcp.tickerdb.com` supports OAuth 2.1 for Claude.ai Connectors. No API key management required â€” sign in with your TickerDB account and Claude.ai handles the rest.

### Option 2: Remote server (Bearer token)

Connect any MCP client to `https://mcp.tickerdb.com/mcp` with your API key as a Bearer token.

### Option 3: ChatGPT app backend (OAuth)

Use the hosted MCP endpoint `https://mcp.tickerdb.com/mcp` as the backend for
the TickerDB ChatGPT app. The first ChatGPT submission is tool-only, with no
Apps SDK iframe widget.

For ChatGPT app domain verification, set `OPENAI_APPS_CHALLENGE_TOKEN` on the
remote Worker and verify `https://mcp.tickerdb.com/.well-known/openai-apps-challenge`.

### Option 4: npm package (Claude Desktop, Cursor, etc.)

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

## Structure

This is a three-package workspace:

- **`shared/`** â€” Shared tool definitions, API client, and server factory (internal, not published)
- **`remote/`** â€” Cloudflare Worker deployed at `mcp.tickerdb.com` (Streamable HTTP transport + OAuth 2.1)
- **`local/`** â€” Published npm package `tickerdb-mcp` (stdio transport)

Both the remote server and npm package use the same tool definitions from `shared/`. The MCP server is a thin proxy â€” all tier-based access control, rate limiting, and field filtering is handled by the TickerDB HTTP API.

### Authentication

The remote server supports two authentication methods:

- **Bearer token** â€” pass your `tdb_*` API key directly as `Authorization: Bearer tdb_...`
- **OAuth 2.1** â€” used by Claude.ai Connectors. The server implements dynamic client registration, PKCE, token exchange, and revocation. The `/authorize` endpoint redirects to the main TickerDB site for consent.

For OAuth-backed MCP clients that use mixed authentication, the worker permits unauthenticated `initialize` and `tools/list` discovery on `POST /mcp`, but requires authentication for actual tool execution. Protected tool calls return a standard `401` Bearer challenge with `resource_metadata` pointing at `/.well-known/oauth-protected-resource/mcp` so clients can re-authorize or remount cleanly.

### Session Strategy

The remote worker defaults to **stateless MCP transport**. That is intentional: all TickerDB MCP tools are request/response stateless, while Cloudflare Worker memory is isolate-local and can drift between requests. Defaulting to stateless transport avoids edge session loss that can invalidate connector-discovered `link_...` namespaces mid-chain. In stateless mode the worker only accepts `POST /mcp` requests, uses JSON request/response mode, and rejects `GET`/`DELETE` session lifecycle requests so connector runtimes do not accidentally tear down or rebind a namespace that was never meant to be stateful.

If you need to debug explicit MCP session behavior, set `MCP_SESSION_MODE=stateful`. In that mode, stale or missing `Mcp-Session-Id` headers return explicit errors instead of silently downgrading to a fresh transport.

## Development

```bash
# Install dependencies
npm install

# Type-check the remote worker/shared sources
npm run build

# Dev server for remote worker
npx wrangler dev

# Build the npm package
cd local && npm install && npm run build
```

## Deployment

**Remote server:**
```bash
npx wrangler deploy
```

**npm package + MCP Registry (recommended):**
```bash
# From the monorepo root
export MCP_PUBLISHER_KEY="your_saved_tickerdb_registry_private_key_hex"
./release.sh mcp patch
```

This bumps `local/package.json`, keeps `server.json` in sync, publishes `tickerdb-mcp` to npm, refreshes DNS auth for `tickerdb.com`, and publishes the MCP server metadata to the official MCP Registry.

**npm package only (manual):**
```bash
cd local
npm version patch
npm run build
npm publish
```

