# TickerAPI MCP Server

MCP (Model Context Protocol) server for [TickerAPI](https://tickerapi.ai) — pre-computed market intelligence for AI agents.

Connects TickerAPI to any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and more.

## Available Tools

| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker |
| `compare_assets` | Side-by-side comparison of multiple tickers (Plus+) |
| `list_assets` | Browse all supported tickers |
| `get_watchlist` | Live data for your saved watchlist tickers |
| `get_watchlist_changes` | Field-level diffs since the last pipeline run |
| `add_to_watchlist` | Add tickers to your watchlist |
| `remove_from_watchlist` | Remove tickers from your watchlist |
| `scan_oversold` | Assets in oversold RSI conditions |
| `scan_overbought` | Assets in overbought RSI conditions |
| `scan_breakouts` | Support/resistance breakouts with volume confirmation |
| `scan_unusual_volume` | Volume anomalies relative to historical average |
| `scan_valuation` | Stocks at valuation extremes (PE, growth, historical) |
| `scan_insider_activity` | Notable insider buying/selling (Pro) |
| `get_account` | Account details, plan tier, and usage |
| `create_webhook` | Register a webhook for watchlist changes |
| `list_webhooks` | List registered webhooks |
| `delete_webhook` | Remove a webhook |

All screeners support filtering by `sector`, `asset_class`, `market_cap_tier`, and `date` (historical, Plus+).

## Setup

### Option 1: Claude.ai (OAuth)

The remote server at `mcp.tickerapi.ai` supports OAuth 2.1 for Claude.ai Connectors. No API key management required — sign in with your TickerAPI account and Claude.ai handles the rest.

### Option 2: Remote server (Bearer token)

Connect any MCP client to `https://mcp.tickerapi.ai/mcp` with your API key as a Bearer token.

### Option 3: npm package (Claude Desktop, Cursor, etc.)

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tickerapi": {
      "command": "npx",
      "args": ["tickerapi-mcp-server"],
      "env": {
        "TICKERAPI_KEY": "tapi_your_api_key_here"
      }
    }
  }
}
```

Get an API key at [tickerapi.ai/dashboard](https://tickerapi.ai/dashboard).

## Structure

This is a three-package workspace:

- **`shared/`** — Shared tool definitions, API client, and server factory (internal, not published)
- **`remote/`** — Cloudflare Worker deployed at `mcp.tickerapi.ai` (Streamable HTTP transport + OAuth 2.1)
- **`local/`** — Published npm package `tickerapi-mcp-server` (stdio transport)

Both the remote server and npm package use the same tool definitions from `shared/`. The MCP server is a thin proxy — all tier-based access control, rate limiting, and field filtering is handled by the TickerAPI HTTP API.

### Authentication

The remote server supports two authentication methods:

- **Bearer token** — pass your `tapi_*` API key directly as `Authorization: Bearer tapi_...`
- **OAuth 2.1** — used by Claude.ai Connectors. The server implements dynamic client registration, PKCE, token exchange, and revocation. The `/authorize` endpoint redirects to the main TickerAPI site for consent.

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
