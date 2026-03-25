import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTickerApi } from "../api-client.js";
import { formatApiError } from "../errors.js";

export function registerGetWatchlist(server: McpServer, apiKey: string) {
  server.tool(
    "get_watchlist",
    "Get a condensed watchlist view for multiple tickers in one call. Returns key technical and fundamental indicators per ticker in a compact format. Requires Plus or Pro plan. Plus: up to 10 tickers. Pro: up to 50.",
    {
      tickers: z
        .array(z.string())
        .describe(
          "Array of ticker symbols, e.g. [\"AAPL\", \"MSFT\", \"GOOGL\"]",
        ),
      timeframe: z
        .enum(["daily", "weekly"])
        .optional()
        .describe("Analysis timeframe. Default: daily"),
    },
    async ({ tickers, timeframe }) => {
      const body: Record<string, unknown> = {
        tickers: tickers.map((t) => t.toUpperCase()),
      };
      if (timeframe) body.timeframe = timeframe;

      const { status, data } = await callTickerApi(
        apiKey,
        "/watchlist",
        undefined,
        { method: "POST", body },
      );

      if (status !== 200) return formatApiError(status, data);

      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
      };
    },
  );
}
