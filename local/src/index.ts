import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setApiBase } from "../../shared/src/api-client.js";
import { DEFAULT_LIMITS } from "../../shared/src/hybrid/run.js";
import { createTickerDbServer } from "../../shared/src/server-factory.js";
import { SqliteStore } from "./sqlite-store.js";

// TICKERDB_API_BASE points the stdio server at another deployment; unset = production.
setApiBase(process.env.TICKERDB_API_BASE);

const envInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

const server = createTickerDbServer(process.env.TICKERDB_KEY ?? "", {
  store: new SqliteStore(),
  local: true,
  storeNote: "Tables live in memory for this server process.",
  limits: {
    maxPages: envInt("TICKERDB_FETCH_MAX_PAGES", DEFAULT_LIMITS.maxPages),
    maxRows: envInt("TICKERDB_FETCH_MAX_ROWS", DEFAULT_LIMITS.maxRows),
    inlineMaxChars: envInt("TICKERDB_INLINE_MAX_CHARS", DEFAULT_LIMITS.inlineMaxChars),
  },
});
await server.connect(new StdioServerTransport());
