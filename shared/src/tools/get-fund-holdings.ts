import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetFundHoldings(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_fund_holdings",
    "A fund's full portfolio as public on one date (SEC Form N-PORT), largest positions first: every line as filed (stocks, bonds, cash funds, derivatives) with ticker (TickerDB symbol on that date when the CUSIP maps to an asset we cover, else null), cusip, isin, balance, value_usd, weight_pct (percent of net assets), asset_category (EC = common stock). Point in time: filing.filed_on is when the portfolio became public and filing.report_date the quarter end it describes (typically 2-5 months before the date). Coverage starts with the fund's first N-PORT (late 2019). Costs 1 credit plus 1 per 100 lines beyond 100.",
    {
      fund: z.string().describe("Fund ticker (e.g. \"IVV\", \"ARKK\", \"VFIAX\") or SEC series id; find with get_funds."),
      date: z.string().optional().describe("Date YYYY-MM-DD (default today). History depth depends on plan."),
      limit: z.number().int().min(1).max(5000).optional().describe("Lines per page, default 500, max 5000."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ fund, date, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/funds/holdings", {
        fund: fund.trim().toUpperCase(),
        date,
        limit: limit?.toString(),
        offset: offset?.toString(),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
