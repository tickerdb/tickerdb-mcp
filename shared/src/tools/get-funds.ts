import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetFunds(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_funds",
    "Find funds (ETFs and mutual funds) that publish holdings to the SEC on Form N-PORT, by name words or ticker, largest first. Each fund has fund_id (SEC series id), tickers, is_etf, its first and newest public portfolio dates. Then use get_fund_holdings for a portfolio, or held_by in get_universe / get_search. Names, tickers and sizes are current, not point in time. Costs 1 credit.",
    {
      q: z.string().optional().describe("Words of the fund's name, any order, e.g. \"ark innovation\" or \"core s&p 500\"."),
      ticker: z.string().optional().describe("A fund ticker (e.g. \"IVV\", \"VFIAX\") or SEC series id (\"S000004310\")."),
      etf_only: z.boolean().optional().describe("true: only ETFs listed in TickerDB."),
      limit: z.number().int().min(1).max(100).optional().describe("Rows per page, default 20, max 100."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ q, ticker, etf_only, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/funds", {
        q,
        ticker: ticker?.trim().toUpperCase(),
        etf_only: etf_only?.toString(),
        limit: limit?.toString(),
        offset: offset?.toString(),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
