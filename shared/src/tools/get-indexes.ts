import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetIndexes(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_indexes",
    "List the indexes whose membership TickerDB tracks (sp500, sp400, sp600, sp100, nasdaq100, russell1000, russell2000), each with the fund it is read from (e.g. IVV for the S&P 500), its first covered date (late 2019) and today's member count. Membership is the SEC Form N-PORT holdings of a fully replicating fund, point in time by filing date: typically 2-5 months behind the index provider's own changes. Use the ids with get_index_members, or as member_of in get_universe / get_search. Costs 1 credit.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async () => {
      const { status, data } = await callTickerDb(apiKey, "/indexes", {});

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
