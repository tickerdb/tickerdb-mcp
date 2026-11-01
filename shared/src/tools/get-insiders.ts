import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerDb } from "../api-client.js";
import { formatApiError } from "../errors.js";
import { formatTickerDbResult, tickerDbOAuthMeta, tickerDbOutputSchema } from "./result.js";

export function registerGetInsiders(server: McpServer, apiKey: string) {
  const tool = server.tool(
    "get_insiders",
    "Find insiders (people and organisations whose trades are disclosed in SEC Form 4: CEOs, officers, directors, 10%+ owners including funds) by name, ticker or type, or list them most active first. Step 1 of a copy/inverse insider model ('make a model that copies Bezos'): search the name, pick the right result from its companies, roles and activity, then call get_insider_trades with its slug. Names match in any order and case, word prefixes, common nicknames (bill = william) and small typos. Filers use legal names (Jensen Huang files as 'Huang Jen Hsun'): if a full name finds nothing, search the surname alone. Each result has lag_days_median/_p90 (days from trade to public disclosure) and late_filing_share.",
    {
      q: z.string().optional().describe("Name to search, e.g. \"jeff bezos\" or \"pershing square\". Omit to list."),
      ticker: z.string().optional().describe("Only insiders who filed at this company, e.g. \"AMZN\"."),
      kind: z.enum(["person", "entity"]).optional().describe("person or entity (funds, trusts, companies)."),
      category: z
        .enum(["ceo", "cfo", "coo", "president", "chair", "officer", "director", "ten_percent_owner"])
        .optional()
        .describe("Role ever held at any company."),
      active_since: z.string().optional().describe("YYYY-MM-DD: last disclosure on or after this date."),
      limit: z.number().int().min(1).max(100).optional().describe("Results per page, default 20, max 100."),
      offset: z.number().int().min(0).optional().describe("Paging offset, default 0."),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ q, ticker, kind, category, active_since, limit, offset }) => {
      const { status, data } = await callTickerDb(apiKey, "/insiders", {
        q,
        ticker: ticker?.trim().toUpperCase(),
        kind,
        category,
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
