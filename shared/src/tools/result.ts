import { z } from "zod";

export const tickerDbOutputSchema = {
  data: z
    .unknown()
    .describe("The TickerDB API response payload for this tool call."),
};

export function formatTickerDbResult(data: unknown, text = JSON.stringify(data)) {
  return {
    structuredContent: { data },
    content: [{ type: "text" as const, text }],
  };
}
