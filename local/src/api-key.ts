import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

/**
 * Where the stdio server finds its API key, in the same order as https://tickerdb.com/setup:
 *   1. the TICKERDB_API_KEY environment variable (TICKERDB_KEY, the 2.x name, still works);
 *   2. a TICKERDB_API_KEY= line in the .env of the working directory;
 *   3. the user config file written by device login:
 *      macOS / Linux: $XDG_CONFIG_HOME/tickerdb/config.json (default ~/.config/tickerdb/config.json)
 *      Windows:       %APPDATA%\tickerdb\config.json
 * The key itself is never logged; only the source is reported.
 */

export type ApiKeySource = "env" | "dotenv" | "config";

export interface ResolvedApiKey {
  key: string;
  source: ApiKeySource;
  /** The file the key came from (dotenv / config). */
  path?: string;
}

export interface ResolveDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: NodeJS.Platform;
  homedir?: string;
  /** Returns the file's text, or undefined when it cannot be read. */
  readFile?: (path: string) => string | undefined;
}

export const SETUP_URL = "https://tickerdb.com/setup";

const defaultReadFile = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** The device-login config file for this platform. */
export function configFilePath(deps: Pick<ResolveDeps, "env" | "platform" | "homedir"> = {}): string {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const home = deps.homedir ?? homedir();
  if (platform === "win32") {
    const appData = env.APPDATA?.trim() || win32.join(home, "AppData", "Roaming");
    return win32.join(appData, "tickerdb", "config.json");
  }
  // XDG says a relative XDG_CONFIG_HOME is invalid and should be ignored.
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.startsWith("/") ? xdg : posix.join(home, ".config");
  return posix.join(base, "tickerdb", "config.json");
}

/** The value of TICKERDB_API_KEY in .env text (last assignment wins, like most loaders). */
export function parseDotenvKey(text: string, name = "TICKERDB_API_KEY"): string | undefined {
  let found: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== name) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
      value = value.slice(1, value.indexOf(quote, 1));
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    found = value;
  }
  return found || undefined;
}

function parseConfigKey(text: string): string | undefined {
  try {
    const data = JSON.parse(text.replace(/^﻿/, ""));
    const key = data && typeof data === "object" ? (data as Record<string, unknown>).api_key : undefined;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function resolveApiKey(deps: ResolveDeps = {}): ResolvedApiKey | undefined {
  const env = deps.env ?? process.env;
  const readFile = deps.readFile ?? defaultReadFile;

  const fromEnv = env.TICKERDB_API_KEY?.trim() || env.TICKERDB_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };

  const dotenvPath = join(deps.cwd ?? process.cwd(), ".env");
  const dotenvText = readFile(dotenvPath);
  const fromDotenv = dotenvText === undefined ? undefined : parseDotenvKey(dotenvText);
  if (fromDotenv) return { key: fromDotenv, source: "dotenv", path: dotenvPath };

  const configPath = configFilePath({ env, platform: deps.platform, homedir: deps.homedir });
  const configText = readFile(configPath);
  const fromConfig = configText === undefined ? undefined : parseConfigKey(configText);
  if (fromConfig) return { key: fromConfig, source: "config", path: configPath };

  return undefined;
}

/**
 * A getter for the server: looks the key up on each call until one is found, then
 * keeps it, so a key saved by device login mid-session works without a restart.
 */
export function apiKeyGetter(deps: ResolveDeps = {}): () => string {
  let cached: string | undefined;
  return () => (cached ??= resolveApiKey(deps)?.key) ?? "";
}
