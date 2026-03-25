# tickerapi-mcp-server

MCP server for [TickerAPI](https://tickerapi.ai) — pre-computed market intelligence for AI agents.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and any MCP-compatible client.

## Setup

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

## Available Tools

| Tool | Description | Tier |
|---|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker | Free |
| `list_assets` | Browse all supported tickers | Free |
| `scan_oversold` | Assets in oversold RSI conditions | Free |
| `scan_breakouts` | Support/resistance breakouts with volume confirmation | Free |
| `scan_unusual_volume` | Volume anomalies relative to historical average | Free |
| `scan_valuation` | Stocks at valuation extremes (PE, growth, historical) | Free |
| `compare_assets` | Side-by-side comparison of multiple tickers | Plus |
| `get_watchlist` | Condensed view for multiple tickers in one call | Plus |
| `scan_insider_activity` | Notable insider buying/selling | Pro |

All tools return categorical, pre-computed data designed for LLM context windows — no raw OHLCV, no post-processing needed.

## Remote Server

You can also connect directly to the hosted MCP server at `https://mcp.tickerapi.ai` with your API key as a Bearer token, without installing this package.

## Documentation

Full API docs and endpoint details at [tickerapi.ai/docs](https://tickerapi.ai/docs).
