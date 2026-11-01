import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetIndexMembers(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_index_members",
    "An index's members on one date, point in time: the long stock positions of its tracking fund's newest SEC N-PORT portfolio FILED by that date (source.report_date is the portfolio's own quarter-end date, source.filed_on when it became public; a stock added to the index after report_date appears with the next filing). Each member has ticker (as of the date), name and weight_pct (percent of fund net assets). Ids from get_indexes. To screen members by fields, use get_universe or get_search with member_of instead. Costs 1 credit plus 1 per 100 members beyond 100.",
    {
      index: z.string().describe("Index id from get_indexes, e.g. \"sp500\", \"nasdaq100\", \"russell2000\"."),
      date: z.string().optional().describe("Date YYYY-MM-DD (default today). History depth depends on plan."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ index, date }) => {
      const { status, data } = await callTickerDb(apiKey, "/indexes/members", {
        index: index.trim().toLowerCase(),
        date,
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
