import { z } from "zod";

export const tickerDbOutputSchema = {
  data: z
    .unknown()
    .describe("The TickerDB API response payload for this tool call."),
};

export const tickerDbOAuthMeta: Record<string, unknown> = {
  securitySchemes: [{ type: "oauth2", scopes: ["tickerdb"] }],
};

export function formatTickerDbResult(data: unknown, text = JSON.stringify(data)) {
  return {
    structuredContent: { data },
    content: [{ type: "text" as const, text }],
  };
}
