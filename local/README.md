# tickerdb-mcp

MCP server for [TickerDB](https://tickerdb.com) — financial data for AI agents.

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
        "TICKERDB_KEY": "tapi_your_api_key_here"
      }
    }
  }
}
```

Get an API key at [tickerdb.com/dashboard](https://tickerdb.com/dashboard).

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

All tools are available on every tier (Free, Plus, Pro) — tiers differ by rate limits, history depth, and watchlist size. See [tickerdb.com/pricing](https://tickerdb.com/pricing) for details.

All tools return categorical, pre-computed data designed for LLM context windows — no raw OHLCV, no post-processing needed.
`get_watchlist` does not take a timeframe. Use `get_watchlist_changes` for daily or weekly diffs.

## Remote Server

You can also connect directly to the hosted MCP server at `https://mcp.tickerdb.com` with your API key as a Bearer token, without installing this package.

## Documentation

Full API docs and endpoint details at [tickerdb.com/docs](https://tickerdb.com/docs).
