# TickerDB - Financial context for agents.

Pre-computed market data that improves agent reasoning, reduces token usage, and replaces custom data pipelines.

Connects TickerDB to any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and more.

## Available Tools


| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker (supports date range and events filtering) |
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

Use `get_summary` with `start`/`end` params for bulk ticker syncs across a date range, or with `field`/`band` params to query event occurrences.
`get_watchlist` does not take a timeframe. Use `get_watchlist_changes` for daily or weekly diffs.

Current summary snapshots also expose top-level freshness via `as_of_date`, richer `volume` fields such as `price_direction_on_volume`, paid-tier level metadata like `support_level.status_meta`, Pro `sector_context` fields such as `agreement` and `overbought_count`, and stock-only nested `fundamentals.insider_activity` when available.

### Band Stability Metadata

Summary, watchlist, and watchlist changes tools return **band stability metadata**. Each band field (trend direction, momentum zone, etc.) includes a sibling `_meta` object describing how stable that state is. The stability label is one of `fresh`, `holding`, `established`, or `volatile`. Full metadata also includes `periods_in_current_state`, `flips_recent`, and `flips_lookback`. This context helps agents distinguish between a newly entered state and one that has persisted for many periods, improving the quality of trade signals and alerts.

## Setup

### Option 1: Claude.ai (OAuth)

The remote server at `mcp.tickerdb.com` supports OAuth 2.1 for Claude.ai Connectors. No API key management required â€” sign in with your TickerDB account and Claude.ai handles the rest.

### Option 2: Remote server (Bearer token)

Connect any MCP client to `https://mcp.tickerdb.com/mcp` with your API key as a Bearer token.

### Option 3: npm package (Claude Desktop, Cursor, etc.)

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tickerdb": {
      "command": "npx",
      "args": ["tickerdb-mcp"],
      "env": {
        "TICKERDB_KEY": "ta_your_api_key_here"
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

- **Bearer token** â€” pass your `ta_*` API key directly as `Authorization: Bearer ta_...`
- **OAuth 2.1** â€” used by Claude.ai Connectors. The server implements dynamic client registration, PKCE, token exchange, and revocation. The `/authorize` endpoint redirects to the main TickerDB site for consent.

### Session Strategy

The remote worker defaults to **stateless MCP transport**. That is intentional: all TickerDB MCP tools are request/response stateless, while Cloudflare Worker memory is isolate-local and can drift between requests. Defaulting to stateless transport avoids edge session loss that can invalidate connector-discovered `link_...` namespaces mid-chain.

If you need to debug explicit MCP session behavior, set `MCP_SESSION_MODE=stateful`. In that mode, stale or missing `Mcp-Session-Id` headers return explicit errors instead of silently downgrading to a fresh transport.

## Development

```bash
# Install dependencies
npm install

# Build the remote worker
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

**npm package:**
```bash
cd local
npm version patch
npm run build
npm publish
```

