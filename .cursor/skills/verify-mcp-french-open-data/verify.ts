/**
 * Drives the real server the way an MCP client does, over stdio and
 * Streamable HTTP, against the live APIs, and records evidence.
 *
 *   npx tsx .cursor/skills/verify-mcp-french-open-data/verify.ts doctor
 *   npx tsx .cursor/skills/verify-mcp-french-open-data/verify.ts run [--skip-build] [--out DIR]
 *
 * Exit code 0 means every check passed. Evidence: DIR (default
 * artifacts/verify/<UTC timestamp>/) with transcript.txt, results.json and
 * the server stderr logs.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(import.meta.dirname, "../../..");
const entry = join(root, "dist/index.js");
const usage = "usage: verify.ts doctor | verify.ts run [--skip-build] [--out DIR]";
function parseArgs(argv: string[]) {
  const [command = "run", ...rest] = argv;
  if (command !== "doctor" && command !== "run") throw new Error(`unknown command ${command}\n${usage}`);
  let skipBuild = false;
  let out: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (command === "run" && arg === "--skip-build") skipBuild = true;
    else if (command === "run" && arg === "--out") {
      const value = rest[++i];
      if (value === undefined || value === "" || value.startsWith("--")) throw new Error(`--out needs a directory\n${usage}`);
      out = value;
    } else throw new Error(`unexpected argument ${arg}\n${usage}`);
  }
  return { command, skipBuild, out };
}
let args: ReturnType<typeof parseArgs>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const { command, skipBuild } = args;
const outDir = resolve(root, args.out ?? join("artifacts/verify", new Date().toISOString().replace(/[:.]/g, "-")));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
let transcript = "";
const say = (line: string) => {
  transcript += line + "\n";
  console.log(line);
};
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  say(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Json = Record<string, unknown> & { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(client: Client, tool: string, args: Record<string, unknown>) {
  say(`> ${tool} ${JSON.stringify(args)}`);
  const result = await client.callTool({ name: tool, arguments: args });
  const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  say(text.split("\n").slice(0, 12).join("\n") + (text.split("\n").length > 12 ? "\n  …" : ""));
  let body: Json | Json[] | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { isError: result.isError === true, text, body };
}

const SUMMARY_KEYS = ["acronym", "category", "created", "establishments", "head_office", "headcount_band", "naf", "name", "siren", "status"];
const DETAILS_KEYS = [...SUMMARY_KEYS, "closed", "finances", "leaders", "legal_form_code", "vat_number"];
const HEAD_OFFICE_KEYS = ["address", "city", "lat", "lon", "postcode", "siret"];
const LEADER_KEYS = ["kind", "name", "role"];
/** True when the object has exactly these keys, so nothing upstream leaks through. */
const sameKeys = (value: unknown, keys: string[]) =>
  typeof value === "object" && value !== null && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
/** The French intra-community VAT number, derived from the SIREN. */
const vatNumber = (siren: string) => `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, "0")}${siren}`;

/** The five tool journeys and the invalid-input journey, with sanity checks. */
async function journeys(client: Client, via: string) {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort().join(",");
  check(`${via}: tools/list`, names === "get_company,list_communes,reverse_geocode,search_address,search_company", names);
  check(`${via}: tools are read-only`, tools.every((t) => t.annotations?.readOnlyHint === true));

  const address = await call(client, "search_address", { query: "20 avenue de Ségur Paris", limit: 1 });
  const a = (address.body as Json[] | undefined)?.[0];
  check(
    `${via}: search_address`,
    !address.isError && a?.postcode === "75007" && /s[ée]gur/i.test(a?.label) && a.lat > 48.8 && a.lat < 48.9 && a.lon > 2.25 && a.lon < 2.4,
    a ? `${a.label} (${a.lat}, ${a.lon}) score ${a.score}` : address.text,
  );

  const reverse = await call(client, "reverse_geocode", { lat: 45.7578, lon: 4.832 });
  const r = (reverse.body as Json[] | undefined)?.[0];
  check(
    `${via}: reverse_geocode`,
    !reverse.isError && r?.city === "Lyon" && typeof r?.distance_m === "number" && r.distance_m < 1000,
    r ? `${r.label}, ${r.distance_m} m` : reverse.text,
  );

  const search = await call(client, "search_company", { query: "la poste", per_page: 5 });
  const s = search.body as Json | undefined;
  const results = (s?.results as Json[] | undefined) ?? [];
  check(
    `${via}: search_company`,
    !search.isError &&
      s?.total > 0 &&
      results.length > 0 &&
      results.length <= 5 &&
      results.every((c) => /^\d{9}$/.test(c.siren) && sameKeys(c, SUMMARY_KEYS) && sameKeys(c.head_office, HEAD_OFFICE_KEYS)) &&
      results.some((c) => /poste/i.test(c.name)),
    s ? `${s.total} results; top: ${(s.results as Json[]).map((c) => `${c.siren} ${c.name}`).join(" | ")}` : search.text,
  );

  const company = await call(client, "get_company", { siren: "356000000" });
  const c = company.body as Json | undefined;
  check(
    `${via}: get_company`,
    !company.isError &&
      sameKeys(c, DETAILS_KEYS) &&
      sameKeys(c?.head_office, HEAD_OFFICE_KEYS) &&
      Array.isArray(c?.leaders) &&
      (c?.leaders as Json[]).every((l) => sameKeys(l, LEADER_KEYS)) &&
      c?.siren === "356000000" &&
      /poste/i.test(c?.name) &&
      c?.vat_number === vatNumber("356000000") &&
      c?.head_office?.siret?.startsWith("356000000"),
    c ? `${c.name}, VAT ${c.vat_number}, head office ${c.head_office?.city}, ${c.leaders?.length} leaders` : company.text,
  );

  const communes = await call(client, "list_communes", { postcode: "69001" });
  const m = communes.body as Json | undefined;
  check(
    `${via}: list_communes`,
    !communes.isError && (m?.communes as Json[] | undefined)?.some((x) => x.insee_code === "69123" && x.name === "Lyon" && x.population > 400000) === true,
    m ? (m.communes as Json[]).map((x) => `${x.name} ${x.insee_code} pop ${x.population}`).join(", ") : communes.text,
  );

  const invalid = await call(client, "get_company", { siren: "12" });
  check(`${via}: invalid SIREN is refused`, invalid.isError && /9-digit SIREN/.test(invalid.text), invalid.text);
}

const logLines = (path: string): Json[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Json;
      } catch {
        return { unparsed: line };
      }
    });

function checkLogs(via: string, path: string, secret?: string) {
  const lines = logLines(path);
  const raw = readFileSync(path, "utf8");
  check(`${via}: stderr log is JSON lines`, lines.length > 0 && lines.every((l) => !("unparsed" in l)), `${lines.length} lines`);
  const tools = new Set(lines.filter((l) => l.msg === "tool call" && l.ok === true).map((l) => l.tool));
  check(`${via}: log records each successful tool call`, tools.size === 5, [...tools].sort().join(","));
  check(`${via}: log records upstream status`, lines.some((l) => l.msg === "upstream request" && l.status === 200));
  if (secret) check(`${via}: log never contains the API key`, !raw.includes(secret));
}

const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });

/** Waits for the first log line with this msg and returns it. */
async function waitForLog(path: string, msg: string, child: ChildProcess, ms: number): Promise<Json> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    const line = existsSync(path) ? logLines(path).find((l) => l.msg === msg) : undefined;
    if (line) return line;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no "${msg}" log line in ${path} after ${ms} ms`);
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );

/** dist/ exists and no source or build input is newer than it. */
function distFresh(): { ok: boolean; detail: string } {
  if (!existsSync(entry)) return { ok: false, detail: "dist/index.js missing; run npm run build" };
  const built = statSync(entry).mtimeMs;
  const inputs = [...sourceFiles(join(root, "src")), join(root, "tsconfig.json"), join(root, "package.json")];
  const stale = inputs.filter((f) => statSync(f).mtimeMs > built).map((f) => f.slice(root.length + 1));
  return stale.length ? { ok: false, detail: `newer than dist: ${stale.join(", ")}; run npm run build` } : { ok: true, detail: `${inputs.length} inputs` };
}

async function doctor(): Promise<boolean> {
  const major = Number(process.versions.node.split(".")[0]);
  check("node >= 20", major >= 20, process.version);
  check("dependencies installed", existsSync(join(root, "node_modules/@modelcontextprotocol/sdk")));
  const fresh = distFresh();
  check("dist/ is built and newer than its inputs", fresh.ok, fresh.detail);
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const source = /export const VERSION = "([^"]+)"/.exec(readFileSync(join(root, "src/server.ts"), "utf8"))?.[1];
  check(
    "package version matches the lockfile and the server",
    pkg.name === "mcp-french-open-data" && /^\d+\.\d+\.\d+$/.test(pkg.version) && lock.version === pkg.version && lock.packages?.[""]?.version === pkg.version && source === pkg.version,
    `${pkg.name}@${pkg.version}, lockfile ${lock.version}, src/server.ts ${source}`,
  );
  for (const url of [
    "https://data.geopf.fr/geocodage/search?q=paris&limit=1",
    "https://recherche-entreprises.api.gouv.fr/search?q=356000000&per_page=1",
    "https://geo.api.gouv.fr/communes?codePostal=69001&fields=nom",
  ]) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch((e: Error) => e);
    check(`upstream reachable: ${new URL(url).host}`, !(res instanceof Error) && res.ok, res instanceof Error ? res.message : `HTTP ${res.status}`);
  }
  return checks.every((c) => c.ok);
}

async function run(): Promise<boolean> {
  mkdirSync(outDir, { recursive: true });
  say(`evidence: ${outDir}`);
  if (!skipBuild) {
    const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8" });
    check("npm run build", build.status === 0, build.status === 0 ? "" : build.stderr);
    if (build.status !== 0) return false;
  }
  const fresh = distFresh();
  check("dist/ is newer than its inputs", fresh.ok, fresh.detail);
  if (!fresh.ok) return false;

  say("\n## stdio");
  const stdioLog = join(outDir, "stdio.stderr.log");
  const stdioErr = createWriteStream(stdioLog);
  const stdio = new StdioClientTransport({ command: "node", args: [entry], stderr: "pipe", env: { ...process.env, LOG_LEVEL: "info" } as Record<string, string> });
  const stdioClient = new Client({ name: "verify-stdio", version: "1.0.0" });
  stdio.stderr?.pipe(stdioErr);
  try {
    await stdioClient.connect(stdio);
    const info = stdioClient.getServerVersion();
    check("stdio: initialize", info?.name === pkg.name && info?.version === pkg.version, JSON.stringify(info));
    await journeys(stdioClient, "stdio");
  } finally {
    await stdioClient.close();
    await new Promise((r) => stdioErr.end(r));
  }
  checkLogs("stdio", stdioLog);

  say("\n## Streamable HTTP");
  const port = await freePort();
  const key = randomBytes(24).toString("hex");
  const url = `http://127.0.0.1:${port}/mcp`;
  const httpLog = join(outDir, "http.stderr.log");
  const server = spawn("node", [entry, "--http"], {
    cwd: root,
    env: { ...process.env, MCP_API_KEY: key, PORT: String(port), HOST: "127.0.0.1", LOG_LEVEL: "info" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr!.pipe(createWriteStream(httpLog));
  try {
    const ready = await waitForLog(httpLog, "listening", server, 10_000);
    check(
      "http: ready",
      ready.transport === "http" && ready.host === "127.0.0.1" && ready.port === port && ready.path === "/mcp" && ready.auth === "api-key" && ready.version === pkg.version,
      JSON.stringify(ready),
    );
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    check("http: /healthz", health.ok, `HTTP ${health.status}`);
    const init = (headers: Record<string, string>) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "1" } } }),
      });
    const noKey = await init({});
    const noKeyBody = await noKey.text();
    check("http: 401 without a key", noKey.status === 401 && /Unauthorized/.test(noKeyBody), `${noKey.status} ${noKeyBody}`);
    const wrong = await init({ authorization: "Bearer wrong-key-0123456789" });
    check("http: 401 with a wrong key", wrong.status === 401, String(wrong.status));
    const xKey = await init({ "x-api-key": key });
    check("http: x-api-key accepted", xKey.status === 200, String(xKey.status));
    const httpClient = new Client({ name: "verify-http", version: "1.0.0" });
    try {
      await httpClient.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
      await journeys(httpClient, "http");
    } finally {
      await httpClient.close();
    }
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => (server.exitCode !== null ? r(null) : server.once("exit", r)));
  }
  checkLogs("http", httpLog, key);
  const rejected = logLines(httpLog).filter((l) => l.msg === "rejected request").map((l) => l.reason);
  check("http: log records rejected requests", rejected.includes("no key") && rejected.includes("bad key"), rejected.join(","));
  return checks.every((c) => c.ok);
}

const ok = command === "doctor" ? await doctor() : await run();
const failed = checks.filter((c) => !c.ok).length;
say(`\n${checks.length - failed}/${checks.length} checks passed`);
if (command === "run") {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ ok, checks }, null, 2) + "\n");
  writeFileSync(join(outDir, "transcript.txt"), transcript);
}
process.exit(ok ? 0 : 1);
