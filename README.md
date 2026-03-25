# TickerAPI MCP Server

MCP (Model Context Protocol) server for [TickerAPI](https://tickerapi.ai) — pre-computed market intelligence for AI agents.

Connects TickerAPI to any MCP-compatible client: Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and more.

## Structure

This is a three-package workspace:

- **`shared/`** — Shared tool definitions, API client, and server factory (internal, not published)
- **`remote/`** — Cloudflare Worker deployed at `mcp.tickerapi.ai` (Streamable HTTP transport)
- **`local/`** — Published npm package `tickerapi-mcp-server` (stdio transport)

Both the remote server and npm package use the same tool definitions from `shared/`. The MCP server is a thin proxy — all tier-based access control, rate limiting, and field filtering is handled by the TickerAPI HTTP API.

## Available Tools

| Tool | Description |
|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker |
| `compare_assets` | Side-by-side comparison of multiple tickers (Plus+) |
| `list_assets` | Browse all supported tickers |
| `get_watchlist` | Condensed view for multiple tickers in one call (Plus+) |
| `scan_oversold` | Assets in oversold RSI conditions |
| `scan_breakouts` | Support/resistance breakouts with volume confirmation |
| `scan_unusual_volume` | Volume anomalies relative to historical average |
| `scan_valuation` | Stocks at valuation extremes (PE, growth, historical) |
| `scan_insider_activity` | Notable insider buying/selling (Pro) |

## Setup

### Option 1: Remote server

Connect any MCP client to `https://mcp.tickerapi.ai` with your API key as a Bearer token.

### Option 2: npm package (Claude Desktop, Cursor, etc.)

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
npm publish
```
