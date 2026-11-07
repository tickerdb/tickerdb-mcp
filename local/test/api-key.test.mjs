// Key lookup order and config paths (dist/api-key.js), with env and fs mocked.
import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyGetter, configFilePath, parseDotenvKey, resolveApiKey } from "../dist/api-key.js";

const CWD = "/work/project";
const HOME = "/home/ana";
const slash = (p) => p.replace(/\\/g, "/");

function deps({ env = {}, files = {}, platform = "linux", home = HOME, cwd = CWD } = {}) {
  const reads = [];
  return {
    reads,
    env,
    cwd,
    platform,
    homedir: home,
    readFile: (p) => {
      reads.push(p);
      return files[p] ?? files[slash(p)];
    },
  };
}

const linuxConfig = `${HOME}/.config/tickerdb/config.json`;
const cfg = (key) => JSON.stringify({ api_key: key });

test("TICKERDB_API_KEY env wins over .env and the config file", () => {
  const d = deps({
    env: { TICKERDB_API_KEY: "tdb_env" },
    files: { [`${CWD}/.env`]: "TICKERDB_API_KEY=tdb_dotenv", [linuxConfig]: cfg("tdb_config") },
  });
  assert.deepEqual(resolveApiKey(d), { key: "tdb_env", source: "env" });
  assert.equal(d.reads.length, 0);
});

test("legacy TICKERDB_KEY env still works, after TICKERDB_API_KEY", () => {
  assert.equal(resolveApiKey(deps({ env: { TICKERDB_KEY: "tdb_old" } })).key, "tdb_old");
  assert.equal(resolveApiKey(deps({ env: { TICKERDB_KEY: "tdb_old", TICKERDB_API_KEY: "tdb_new" } })).key, "tdb_new");
});

test("project .env comes before the config file", () => {
  const d = deps({ files: { [`${CWD}/.env`]: "OTHER=1\nTICKERDB_API_KEY=tdb_dotenv\n", [linuxConfig]: cfg("tdb_config") } });
  const r = resolveApiKey(d);
  assert.equal(r.key, "tdb_dotenv");
  assert.equal(r.source, "dotenv");
  assert.equal(slash(r.path), `${CWD}/.env`);
});

test("config file is used when env and .env have no key", () => {
  const d = deps({ env: { TICKERDB_API_KEY: "  " }, files: { [`${CWD}/.env`]: "TICKERDB_API_KEY=\n", [linuxConfig]: cfg("tdb_config") } });
  assert.deepEqual(resolveApiKey(d), { key: "tdb_config", source: "config", path: linuxConfig });
});

test("nothing found returns undefined; bad JSON is ignored", () => {
  assert.equal(resolveApiKey(deps()), undefined);
  assert.equal(resolveApiKey(deps({ files: { [linuxConfig]: "{not json" } })), undefined);
  assert.equal(resolveApiKey(deps({ files: { [linuxConfig]: cfg(42) } })), undefined);
});

test("XDG_CONFIG_HOME is honoured on Linux and macOS; relative values are ignored", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(configFilePath({ platform, homedir: HOME, env: {} }), linuxConfig);
    assert.equal(configFilePath({ platform, homedir: HOME, env: { XDG_CONFIG_HOME: "/xdg" } }), "/xdg/tickerdb/config.json");
    assert.equal(configFilePath({ platform, homedir: HOME, env: { XDG_CONFIG_HOME: "rel/dir" } }), linuxConfig);
  }
  const d = deps({ env: { XDG_CONFIG_HOME: "/xdg" }, files: { "/xdg/tickerdb/config.json": cfg("tdb_xdg") } });
  assert.equal(resolveApiKey(d).key, "tdb_xdg");
});

test("Windows uses %APPDATA%\\tickerdb\\config.json", () => {
  const appData = "C:\\Users\\Ana\\AppData\\Roaming";
  assert.equal(
    configFilePath({ platform: "win32", homedir: "C:\\Users\\Ana", env: { APPDATA: appData } }),
    `${appData}\\tickerdb\\config.json`,
  );
  // Without APPDATA, fall back to the default Roaming folder; XDG is not used on Windows.
  assert.equal(
    configFilePath({ platform: "win32", homedir: "C:\\Users\\Ana", env: { XDG_CONFIG_HOME: "/xdg" } }),
    "C:\\Users\\Ana\\AppData\\Roaming\\tickerdb\\config.json",
  );
  const d = deps({
    platform: "win32",
    home: "C:\\Users\\Ana",
    cwd: "C:\\proj",
    env: { APPDATA: appData },
    // Windows PowerShell 5.1 can write a BOM.
    files: { [`${appData}\\tickerdb\\config.json`]: "\uFEFF" + cfg("tdb_win") },
  });
  assert.equal(resolveApiKey(d).key, "tdb_win");
});

test(".env parsing: quotes, export, comments, last assignment wins", () => {
  assert.equal(parseDotenvKey('TICKERDB_API_KEY="tdb_q"'), "tdb_q");
  assert.equal(parseDotenvKey("export TICKERDB_API_KEY='tdb_s'"), "tdb_s");
  assert.equal(parseDotenvKey("TICKERDB_API_KEY=tdb_c # comment"), "tdb_c");
  assert.equal(parseDotenvKey("# TICKERDB_API_KEY=tdb_no\r\nTICKERDB_API_KEY=tdb_a\r\nTICKERDB_API_KEY=tdb_b"), "tdb_b");
  assert.equal(parseDotenvKey("MY_TICKERDB_API_KEY=tdb_x"), undefined);
});

test("getter re-checks until a key appears, then keeps it", () => {
  const files = {};
  const d = deps({ files });
  const get = apiKeyGetter(d);
  assert.equal(get(), "");
  files[linuxConfig] = cfg("tdb_later");
  assert.equal(get(), "tdb_later");
  const n = d.reads.length;
  files[linuxConfig] = cfg("tdb_changed");
  assert.equal(get(), "tdb_later");
  assert.equal(d.reads.length, n);
});
