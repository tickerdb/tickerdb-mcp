# TickerDB MCP Server

MCP (Model Context Protocol) server for [TickerDB](https://tickerdb.com) — pre-computed market intelligence for AI agents.

Connects TickerDB to any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and more.

## Available Tools


| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker (supports date range and events filtering) |
| `get_watchlist` | Live data for your saved watchlist tickers |
| `get_watchlist_changes` | Field-level diffs since the last pipeline run |
| `add_to_watchlist` | Add tickers to your watchlist |
| `remove_from_watchlist` | Remove tickers from your watchlist |
| `get_account` | Account details, plan tier, and usage |
| `create_webhook` | Register a webhook for watchlist changes |
| `list_webhooks` | List registered webhooks |
| `delete_webhook` | Remove a webhook |

Use `get_summary` with `start`/`end` params for bulk ticker syncs across a date range, or with `field`/`band` params to query event occurrences.

### Band Stability Metadata

Summary, watchlist, and watchlist changes tools return **band stability metadata**. Each band field (trend direction, momentum zone, etc.) includes a sibling `_meta` object describing how stable that state is. The stability label is one of `fresh`, `holding`, `established`, or `volatile`. Full metadata also includes `periods_in_current_state`, `flips_recent`, and `flips_lookback`. This context helps agents distinguish between a newly entered state and one that has persisted for many periods, improving the quality of trade signals and alerts.

## Setup

### Option 1: Claude.ai (OAuth)

The remote server at `mcp.tickerdb.com` supports OAuth 2.1 for Claude.ai Connectors. No API key management required — sign in with your TickerDB account and Claude.ai handles the rest.

### Option 2: Remote server (Bearer token)

Connect any MCP client to `https://mcp.tickerdb.com/mcp` with your API key as a Bearer token.

### Option 3: npm package (Claude Desktop, Cursor, etc.)

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tickerdb": {
      "command": "npx",
      "args": ["tickerdb-mcp-server"],
      "env": {
        "TICKERDB_KEY": "tapi_your_api_key_here"
      }
    }
  }
}
```

Get an API key at [tickerdb.com/dashboard](https://tickerdb.com/dashboard).

## Structure

This is a three-package workspace:

- **`shared/`** — Shared tool definitions, API client, and server factory (internal, not published)
- **`remote/`** — Cloudflare Worker deployed at `mcp.tickerdb.com` (Streamable HTTP transport + OAuth 2.1)
- **`local/`** — Published npm package `tickerdb-mcp-server` (stdio transport)

Both the remote server and npm package use the same tool definitions from `shared/`. The MCP server is a thin proxy — all tier-based access control, rate limiting, and field filtering is handled by the TickerDB HTTP API.

### Authentication

The remote server supports two authentication methods:

- **Bearer token** — pass your `tapi_*` API key directly as `Authorization: Bearer tapi_...`
- **OAuth 2.1** — used by Claude.ai Connectors. The server implements dynamic client registration, PKCE, token exchange, and revocation. The `/authorize` endpoint redirects to the main TickerDB site for consent.

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
