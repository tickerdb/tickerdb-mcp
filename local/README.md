# tickerdb-mcp-server

MCP server for [TickerDB](https://tickerdb.com) — pre-computed market intelligence for AI agents.

Works with Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw, LangChain, LlamaIndex, AutoGen, CrewAI, and any MCP-compatible client.

## Setup

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

## Available Tools

| Tool | Description | Tier |
|---|---|---|
| `get_summary` | Technical + fundamental summary for a single ticker (supports date range and events filtering) | Free |
| `get_watchlist` | Live data for your saved watchlist tickers | Plus |
| `get_watchlist_changes` | Field-level diffs since the last pipeline run | Plus |
| `add_to_watchlist` | Add tickers to your watchlist | Plus |
| `remove_from_watchlist` | Remove tickers from your watchlist | Plus |
| `get_account` | Account details, plan tier, and usage | Free |
| `create_webhook` | Register a webhook for watchlist changes | Plus |
| `list_webhooks` | List registered webhooks | Plus |
| `delete_webhook` | Remove a webhook | Plus |

All tools return categorical, pre-computed data designed for LLM context windows — no raw OHLCV, no post-processing needed.

## Remote Server

You can also connect directly to the hosted MCP server at `https://mcp.tickerdb.com` with your API key as a Bearer token, without installing this package.

## Documentation

Full API docs and endpoint details at [tickerdb.com/docs](https://tickerdb.com/docs).
