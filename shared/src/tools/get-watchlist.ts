import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetWatchlist(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_watchlist",
    "Get analytical summaries for every ticker on the user's saved watchlist. This supports requests about the user's watchlist, tracked stocks, portfolio tickers, or an overview of tracked assets. Each item includes trend, momentum, volatility, volume, extremes, support/resistance prices, and a notable_changes array of human-readable day-over-day change alerts (e.g. 'entered deep_oversold', 'volume spike', 'trend reversed to downtrend', 'earnings within days', 'squeeze activated', 'MA crossover: golden cross'). Additional per-item fields include squeeze_active, squeeze_days, climax_detected, climax_type, divergence_detected, divergence_type. Plus/Pro plans also return analyst_consensus, earnings_proximity, growth_zone, free_cash_flow. Pro plans also return insider_activity and insider_net_direction. Band fields include _meta stability objects on Plus and Pro plans. Use add_to_watchlist to save tickers first.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/watchlist");

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
