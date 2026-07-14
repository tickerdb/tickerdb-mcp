import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOutputSchema } from "./result.js";

export function registerGetAccount(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_account",
    "Get your account details including current plan tier, monthly credit limits, and current usage. Response includes tier, limits (monthly_requests, overage_enabled, watchlist_limit, search_results, webhook_urls, history_days), and usage (monthly_requests_used, monthly_requests_remaining, credit_balance for pay-per-use accounts). Also returns scheduled_tier and scheduled_change_at if a plan change is pending.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/account");

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema });
}
