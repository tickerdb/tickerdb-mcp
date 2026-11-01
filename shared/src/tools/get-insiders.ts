import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetInsiders(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_insiders",
    "Find insiders (people and organisations whose trades are disclosed in SEC Form 4: CEOs, officers, directors, 10%+ owners including funds) by name, ticker or type, or list them most active first. Step 1 of a copy/inverse insider model ('make a model that copies Bezos'): search the name, pick the right result from its companies, roles and activity, then call get_insider_trades with its slug. Search is loose: any order and case, word starts, initials, nicknames both ways (bill = william), typos, run-together or split names (jeffbezos, value act), legal suffixes ignored, and extra words tolerated (half the words must match; full matches rank first, matched_words says how many matched). Several people can share a name: check companies and roles. Curated aliases cover famous names filed differently (Jensen Huang files as 'Huang Jen Hsun'). Each result has lag_days_median/_p90 (days from trade to public disclosure) and late_filing_share.",
    {
      q: z.string().optional().describe("Name to search, e.g. \"jeff bezos\" or \"pershing square\". Omit to list."),
      ticker: z.string().optional().describe("Only insiders who filed at this company, e.g. \"AMZN\"."),
      type: z.enum(["person", "organization"]).optional().describe("person or organization (funds, trusts, companies)."),
      role: z
        .enum(["ceo", "cfo", "coo", "president", "chair", "officer", "director", "ten_percent_owner"])
        .optional()
        .describe("Role ever held at any company."),
      active_since: z.string().optional().describe("YYYY-MM-DD: last disclosure on or after this date."),
      limit: z.number().int().min(1).max(100).optional().describe("Results per page, default 20, max 100."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ q, ticker, type, role, active_since, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/insiders", {
        q,
        ticker: ticker?.trim().toUpperCase(),
        type,
        role,
        active_since,
        limit: limit?.toString(),
        offset: offset?.toString(),
      });

      if (status !== 200) return formatApiError(status, data);

      return formatTickerDbResult(data);
    },
  );
  tool.update({ outputSchema: tickerDbOutputSchema, _meta: tickerDbOAuthMeta });
}
