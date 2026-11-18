#!/usr/bin/env node
/**
 * build-tests — grade a whole build with tests the candidate never saw.
 *
 * The work dir is the candidate's finished project. This check:
 *   1. installs its dependencies (by its lockfile);
 *   2. brings up its compose services (own project name, host ports remapped to
 *      free ones) and writes .env from .env.example;
 *   3. runs its `db:fresh` script (else, or when that refuses, `db:migrate`);
 *   4. starts it the way its root package.json says (`dev`, else every `dev:*`,
 *      else each workspace's `dev`), and finds the API and the web page from
 *      what it prints and by probing;
 *   5. runs the held-out suite for this input (references/build/_heldout/<input>/,
 *      hidden from candidates during a run): `api.test.mjs` under node:test with
 *      API_URL, the specs in `ui/` under Playwright with WEB_URL (and API_URL);
 *   6. stops everything it started.
 *
 * Exit 0 when the app came up and the suite ran (whatever its pass rate),
 * 1 when the app never came up. The pass rate is the measurement and is in
 * the evidence (`held-out a/b`); agenteval's checks are pass/fail only.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK = path.dirname(HERE);
const RUNNER = path.join(HERE, "heldout-runner"); // has @playwright/test installed
const cwd = process.cwd();
const meta = existsSync("meta.json") ? JSON.parse(readFileSync("meta.json", "utf-8")) : {};
const input = meta.input ?? process.env.EVAL_INPUT;
const refs = process.env.EVAL_REFERENCES_DIR ?? path.join(TASK, "references");
const suite = path.join(refs, "build", "_heldout", input ?? "?");
const log = [];
const say = (s) => { log.push(s); console.error(s); };

function finish(code, evidence, extra = {}) {
  console.log(JSON.stringify({ evidence, ...extra }));
  process.exit(code);
}
if (!input || !existsSync(suite)) finish(2, `no held-out suite for input ${input} at ${suite}`, { reason: "setup" });

const children = [];
const project = `evalbuild${process.pid}`;
let composeFile = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].find((f) => existsSync(f));

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: opts.timeoutMs ?? 10 * 60_000, env: { ...process.env, CI: "1", ...opts.env } });
  return { code: r.status ?? (r.error ? 124 : 1), out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function cleanup() {
  for (const c of children) { try { process.kill(-c.pid, "SIGTERM"); } catch {} }
  if (composeFile) sh("docker", ["compose", "-p", project, "-f", composeFile, "down", "-v", "--remove-orphans"], { timeoutMs: 120_000 });
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => process.exit(1));

const pkgPath = path.join(cwd, "package.json");
if (!existsSync(pkgPath)) finish(1, "the build has no root package.json: nothing to start");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const pm = existsSync("pnpm-lock.yaml") ? "pnpm" : existsSync("yarn.lock") ? "yarn" : "npm";
const runScript = (name) => (pm === "npm" ? ["npm", ["run", name]] : [pm, ["run", name]]);

// A build's compose usually publishes fixed host ports (5432, 6379…) that
// another project on the grading host may already hold. Publish each one on a
// free host port instead, in a copy of the compose file, and point the URLs in
// .env at the new port, so the grade never depends on what else is running.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
async function remapComposePorts() {
  const text = readFileSync(composeFile, "utf-8");
  const mapping = new Map();
  const re = /^(\s*-\s*["']?)(?:(127\.0\.0\.1|0\.0\.0\.0|localhost):)?(\d+):(\d+)(["']?\s*)$/gm;
  for (const m of text.matchAll(re)) if (!mapping.has(m[3])) mapping.set(m[3], String(await freePort()));
  if (mapping.size === 0) return;
  const remapped = text.replace(re, (_, pre, host, hostPort, containerPort, post) => `${pre}${host ? `${host}:` : ""}${mapping.get(hostPort)}:${containerPort}${post}`);
  const copy = ".eval-compose.yaml";
  writeFileSync(copy, remapped);
  composeFile = copy;
  if (existsSync(".env")) {
    let env = readFileSync(".env", "utf-8");
    for (const [from, to] of mapping) env = env.replace(new RegExp(`((?:127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0|@[\\w.-]+):)${from}\\b`, "g"), `$1${to}`);
    writeFileSync(".env", env);
  }
  say(`compose host ports remapped: ${[...mapping].map(([a, b]) => `${a}→${b}`).join(", ")}`);
}

// 1. install
const inst = pm === "npm" ? sh("npm", [existsSync("package-lock.json") ? "ci" : "install", "--no-audit", "--no-fund"]) : sh(pm, ["install", "--frozen-lockfile"]);
if (inst.code !== 0) {
  const retry = sh(pm, ["install"]);
  if (retry.code !== 0) finish(1, `install failed: ${retry.out.slice(-800)}`);
}

// 2. services and .env
// A leftover .env is the builder's local state (its own ports), not part of the
// deliverable: start from .env.example whenever the build ships one.
if (existsSync(".env.example")) copyFileSync(".env.example", ".env");
if (composeFile) await remapComposePorts();
if (composeFile) {
  const up = sh("docker", ["compose", "-p", project, "-f", composeFile, "up", "-d", "--wait"], { timeoutMs: 5 * 60_000 });
  if (up.code !== 0) say(`compose up failed (continuing): ${up.out.slice(-400)}`);
}
const envFile = existsSync(".env") ? Object.fromEntries(readFileSync(".env", "utf-8").split("\n").map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])) : {};

// 3. db:fresh
if (pkg.scripts?.["db:fresh"]) {
  const [c, a] = runScript("db:fresh");
  const r = sh(c, a, { env: envFile, timeoutMs: 5 * 60_000 });
  say(`db:fresh exited ${r.code}${r.code ? `: ${r.out.slice(-300)}` : ""}`);
  // db:fresh may refuse a database it doesn't consider disposable; migrations
  // still have to run for the app to work.
  if (r.code !== 0 && pkg.scripts?.["db:migrate"]) {
    const [mc, ma] = runScript("db:migrate");
    const m = sh(mc, ma, { env: envFile, timeoutMs: 5 * 60_000 });
    say(`db:migrate exited ${m.code}${m.code ? `: ${m.out.slice(-300)}` : ""}`);
  }
}

// 4. start
// Ports something else already serves must never be taken for this build.
const DISCOVERY_PORTS = [3000, 3001, 4000, 5000, 5173, 5174, 8000, 8080];
const busy = new Set();
for (const port of DISCOVERY_PORTS) if (await probe(`http://localhost:${port}/`)) busy.add(port);
if (busy.size) say(`already in use before start (ignored): ${[...busy].join(", ")}`);
let output = "";
function start(c, a, dir = cwd) {
  const p = spawn(c, a, { cwd: dir, detached: true, env: { ...process.env, ...envFile, BROWSER: "none", CI: "1" } });
  p.stdout.on("data", (d) => { output += d; });
  p.stderr.on("data", (d) => { output += d; });
  children.push(p);
}
const scripts = pkg.scripts ?? {};
if (scripts.dev) start(...runScript("dev"));
else if (Object.keys(scripts).some((s) => /^dev[:-]/.test(s))) for (const s of Object.keys(scripts).filter((s) => /^dev[:-]/.test(s))) start(...runScript(s));
else if (scripts.start) start(...runScript("start"));
else {
  const dirs = ["server", "client", "api", "web", "backend", "frontend", ...["apps", "services", "packages"].flatMap((d) => (existsSync(d) ? readdirSync(d).map((x) => `${d}/${x}`) : []))];
  for (const d of dirs) {
    const p = path.join(cwd, d, "package.json");
    if (existsSync(p) && JSON.parse(readFileSync(p, "utf-8")).scripts?.dev) start(...runScript("dev"), path.join(cwd, d));
  }
}
if (children.length === 0) finish(1, "nothing to start: no dev/start script at the root or in a workspace");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function probe(url, follow = false) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: follow ? "follow" : "manual" });
    return { status: r.status, type: r.headers.get("content-type") ?? "" };
  } catch { return null; }
}
const API_PROBE = JSON.parse(readFileSync(path.join(suite, "probe.json"), "utf-8")); // { "api": "/api/members" }
let apiUrl, webUrl;
for (let i = 0; i < 90 && !(apiUrl && webUrl); i++) {
  await sleep(2000);
  const ports = [...new Set([...output.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/g)].map((m) => Number(m[1])).concat(DISCOVERY_PORTS))].filter((p) => !busy.has(p));
  for (const port of ports) {
    const base = `http://localhost:${port}`;
    if (!apiUrl) {
      const r = await probe(base + API_PROBE.api);
      if (r && r.status < 500 && r.status !== 404 && r.type.includes("json")) apiUrl = base;
    }
    if (!webUrl) {
      const r = await probe(base + "/", true); // an SPA under a base path redirects "/"
      if (r && r.status < 400 && r.type.includes("html")) webUrl = base;
    }
  }
}
if (!apiUrl && webUrl) {
  const r = await probe(webUrl + API_PROBE.api);
  if (r && r.type.includes("json") && r.status < 500 && r.status !== 404) apiUrl = webUrl; // a dev proxy
}
if (!apiUrl) finish(1, `the API never answered ${API_PROBE.api}. Last output: ${output.slice(-1200)}`);
say(`API at ${apiUrl}; web at ${webUrl ?? "(none)"}`);

// 5. the held-out suite
const results = { api: { pass: 0, total: 0, failed: [] }, ui: { pass: 0, total: 0, failed: [] } };
const apiTest = path.join(suite, "api.test.mjs");
if (existsSync(apiTest)) {
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-concurrency=1", apiTest], { encoding: "utf-8", env: { ...process.env, API_URL: apiUrl }, timeout: 10 * 60_000 });
  for (const m of (r.stdout ?? "").matchAll(/^(not ok|ok) \d+ - (.+)$/gm)) {
    results.api.total++;
    if (m[1] === "ok") results.api.pass++; else results.api.failed.push(m[2]);
  }
}
const uiDir = path.join(suite, "ui");
if (existsSync(uiDir)) {
  const specFiles = readdirSync(uiDir).filter((f) => /\.spec\.[mc]?[jt]s$/.test(f));
  if (!webUrl) {
    const n = specFiles.reduce((k, f) => k + (readFileSync(path.join(uiDir, f), "utf-8").match(/^\s*test\(/gm) ?? []).length, 0);
    results.ui = { pass: 0, total: n, failed: ["(no web page came up)"] };
  } else {
    // A build's own `playwright install` can garbage-collect the browser this
    // runner's Playwright needs; make sure it is there (a no-op when it is).
    const inst = sh(path.join(RUNNER, "node_modules", ".bin", "playwright"), ["install", "chromium"], { timeoutMs: 10 * 60_000 });
    if (inst.code !== 0) say(`playwright install failed: ${inst.out.slice(-300)}`);
    const work = path.join(RUNNER, "run", project);
    cpSync(uiDir, work, { recursive: true });
    writeFileSync(path.join(work, "playwright.config.mjs"),
      `export default { testDir: ".", timeout: 30000, workers: 1, retries: 0, use: { baseURL: ${JSON.stringify(webUrl)}, headless: true } };\n`);
    const report = path.join(work, "report.json");
    spawnSync(path.join(RUNNER, "node_modules", ".bin", "playwright"), ["test", "--config", path.join(work, "playwright.config.mjs"), "--reporter=json"], {
      cwd: work, encoding: "utf-8", env: { ...process.env, API_URL: apiUrl, PLAYWRIGHT_JSON_OUTPUT_NAME: report }, timeout: 15 * 60_000,
    });
    const walk = (s) => [...(s.specs ?? []), ...(s.suites ?? []).flatMap(walk)];
    const specs = existsSync(report) ? (JSON.parse(readFileSync(report, "utf-8")).suites ?? []).flatMap(walk) : [];
    for (const sp of specs) {
      if ((sp.tests ?? []).every((t) => t.status === "skipped" || t.expectedStatus === "skipped")) continue;
      results.ui.total++;
      if (sp.ok) { results.ui.pass++; continue; }
      results.ui.failed.push(sp.title);
      const err = sp.tests?.[0]?.results?.find((x) => x.error)?.error?.message ?? "";
      (results.ui.errors ??= []).push(`${sp.title.split(" ")[0]} ${err.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 300)}`);
    }
    rmSync(work, { recursive: true, force: true });
  }
}
const pass = results.api.pass + results.ui.pass;
const total = results.api.total + results.ui.total;
const failed = [...results.api.failed, ...results.ui.failed];
// The score counts only the parts of the suite that have been adjudicated
// fair to every implementation (scoring.json { "score": ["api"], "why": … });
// the rest still runs and is reported, but does not rank candidates.
const scoring = existsSync(path.join(suite, "scoring.json")) ? JSON.parse(readFileSync(path.join(suite, "scoring.json"), "utf-8")) : {};
const parts = Array.isArray(scoring.score) ? scoring.score.filter((k) => k in results) : ["api", "ui"];
const sPass = parts.reduce((n, k) => n + results[k].pass, 0);
const sTotal = parts.reduce((n, k) => n + results[k].total, 0);
const scoreNote = parts.length < 2 ? `; score counts ${parts.join("+")} only (${scoring.why ?? "the rest is not adjudicated"})` : "";
finish(0, `held-out ${pass}/${total} (api ${results.api.pass}/${results.api.total}, ui ${results.ui.pass}/${results.ui.total})${scoreNote}` +
  (failed.length ? `. Failed: ${failed.map((f) => f.split(" ")[0]).join(", ")}` : ""), { score: sTotal ? sPass / sTotal : 0, results });
