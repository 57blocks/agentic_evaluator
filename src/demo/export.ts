/**
 * `agenteval dash --export DIR`: the dashboard as files, for someone who will
 * not run agenteval. It opens by double-clicking `index.html`, and looks and
 * navigates exactly like `agenteval dash` on the same workspace.
 *
 * It starts the dashboard server in-process on a free port, records every
 * response the pages read (catalog, overview, each report, each run's
 * evidence files, each task's definition files), and writes:
 *
 *   index.html               the static client build, its JS and CSS inlined
 *   data/snapshot-N.js       the recorded responses, as classic scripts
 *   artifact/…/report.html   each run's own report, linked from its page
 *
 * A browser loads no module script and fetches no file from a page opened
 * from disk, which is why the client and the data are scripts, not fetches.
 * Nothing that changes the workspace (starting a run, a blind review) is in
 * an export; the client hides it (client/lib/snapshot.ts).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer, listenDemo } from "./server.js";
import { artifactUrl, reportUrl, taskFileUrl } from "./client/lib/api.js";
import type { Workspace } from "../core/workspace.js";
import type { RunView, TaskView } from "./catalog.js";

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "demo-static");

/** Evidence files a run page reads from each step (client/features/evidence). */
const EVIDENCE_FILES = ["scores.jsonl", "evaluations.jsonl", "GAPS.md"];

/**
 * Task files that look like secrets never go into an export, which is made to
 * be sent to someone: dotenv files, keys and certificates, credential stores.
 * The live dashboard serves only to this machine; an export leaves it.
 */
const SECRET_FILE = /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?)$|\.(pem|key|p12|pfx|keystore)$|credential|secret/i;

export const isSecretFile = (rel: string): boolean => SECRET_FILE.test(rel);

/**
 * Key formats a name check cannot catch: a key pasted into a file with an
 * innocent name, or echoed into a candidate's output. A task file holding one
 * is left out; anywhere else (a report, an output, evidence) the key itself is
 * replaced, since the page needs the rest. A last line of defence, not a
 * guarantee: look at what you export before sending it.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd)[A-Za-z0-9_]*`;

/**
 * A secret-named setting given a literal value: `API_KEY="…"` or `"token": "…"`
 * (quoted, so `token: paymentTokenEnum` and `KEY: process.env.KEY` are code,
 * not keys), and a dotenv line `API_KEY=…`. The value goes, the name stays.
 */
const SECRET_QUOTED = new RegExp(String.raw`\b(${SECRET_NAME}\\?["']?\s*[:=]\s*\\?["'])([A-Za-z0-9_\-/+=.]{16,})(?=\\?["'])`, "gi");
const SECRET_DOTENV = new RegExp(String.raw`^(${SECRET_NAME}=)([^\s"'#]{16,})$`, "gim");

/** A literal that looks like a key: long, and mixing letters with digits. */
const keyLike = (value: string): boolean => /\d/.test(value) && /[A-Za-z]/.test(value) && !/^process\.env\./.test(value);

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return "[redacted]";
    });
  }
  for (const re of [SECRET_QUOTED, SECRET_DOTENV]) {
    out = out.replace(re, (whole: string, name: string, value: string) => {
      if (!keyLike(value)) return whole;
      count++;
      return `${name}[redacted]`;
    });
  }
  return { text: out, count };
}

/** Keep each data script well under what a browser parses comfortably in one go. */
const CHUNK_BYTES = 8 * 1024 * 1024;

interface Recorded {
  status: number;
  body: string;
}

export interface ExportResult {
  outDir: string;
  responses: number;
  reports: number;
  bytes: number;
  /** Task files left out as secret-looking, by name or by content, as `<task>/<path>`. */
  skipped: string[];
  /** Keys replaced by `[redacted]` in reports, outputs and evidence. */
  redacted: number;
}

interface CatalogShape {
  tasks: TaskView[];
  unfiled?: RunView[];
}

/**
 * Local paths say who made the export and where their files live: the
 * workspace root becomes its folder name, the home directory `~`.
 */
function scrubber(root: string): (text: string) => string {
  const home = os.homedir();
  const name = path.basename(root);
  const swaps: Array<[string, string]> = [[root, name], [home, "~"]];
  return (text) => swaps.reduce((t, [from, to]) => (from.length > 1 ? t.split(from).join(to) : t), text);
}

interface Recording {
  into: Map<string, Recorded>;
  scrub: (t: string) => string;
  /** Task files dropped for what they contain. */
  skipped: string[];
  redacted: number;
}

const TASK_FILE = /^\/artifact\/task\/([^/]+)\/(.+)$/;

async function record(base: string, urls: Iterable<string>, rec: Recording): Promise<void> {
  for (const url of urls) {
    if (rec.into.has(url)) continue;
    const res = await fetch(base + url);
    const { text, count } = redactSecrets(rec.scrub(await res.text()));
    const taskFile = url.match(TASK_FILE);
    if (taskFile && count > 0) {
      rec.skipped.push(`${decodeURIComponent(taskFile[1])}/${taskFile[2].split("/").map(decodeURIComponent).join("/")}`);
      rec.into.set(url, { status: 404, body: "" });
      continue;
    }
    rec.redacted += count;
    rec.into.set(url, { status: res.status, body: text });
  }
}

/** The catalog without the secret-looking files, so the export neither lists nor holds them. */
function withoutSecrets(catalog: CatalogShape): { catalog: CatalogShape; skipped: string[] } {
  const skipped: string[] = [];
  const tasks = catalog.tasks.map((t) => {
    const files = (t.files ?? []).filter((rel) => {
      if (!isSecretFile(rel)) return true;
      skipped.push(`${t.name}/${rel}`);
      return false;
    });
    return { ...t, files };
  });
  return { catalog: { ...catalog, tasks }, skipped };
}

function runsOf(catalog: CatalogShape): RunView[] {
  return [...catalog.tasks.flatMap((t) => t.runs ?? []), ...(catalog.unfiled ?? [])];
}

/** Every URL a page of this workspace reads, from the catalog the home page loads. */
function urlsFor(catalog: CatalogShape): string[] {
  const urls: string[] = [];
  for (const task of catalog.tasks) for (const rel of task.files ?? []) urls.push(taskFileUrl(task.name, rel));
  for (const run of runsOf(catalog)) {
    urls.push(reportUrl(run.dir));
    for (const step of run.steps) {
      urls.push(reportUrl(step.dir));
      for (const name of EVIDENCE_FILES) urls.push(artifactUrl(step.dir, name));
    }
  }
  return urls;
}

/** The report.html files a run page links to, as `artifact/…` paths and their server URLs. */
function reportFiles(catalog: CatalogShape): Array<{ rel: string; url: string }> {
  const out = new Map<string, string>();
  for (const run of runsOf(catalog)) {
    if (run.kind === "workflow") out.set(`artifact/${run.dir}/report.html`, `/artifact/${run.dir}/report.html`);
    for (const step of run.steps) if (step.reportHref) out.set(step.reportHref.replace(/^\//, ""), step.reportHref);
  }
  return [...out].map(([rel, url]) => ({ rel, url }));
}

/** `</script>` inside a JSON string would end the script tag early. */
const scriptSafe = (json: string): string => json.replace(/<\/(script)/gi, "<\\/$1");

function chunkScripts(responses: Map<string, Recorded>): string[] {
  const chunks: string[] = [];
  let entries: string[] = [];
  let size = 0;
  const flush = () => {
    if (entries.length === 0) return;
    chunks.push(`window.__AGENTEVAL_SNAPSHOT__=Object.assign(window.__AGENTEVAL_SNAPSHOT__||{},{${entries.join(",")}});\n`);
    entries = [];
    size = 0;
  };
  for (const [url, rec] of responses) {
    const entry = `${JSON.stringify(url)}:${scriptSafe(JSON.stringify(rec))}`;
    if (size + entry.length > CHUNK_BYTES) flush();
    entries.push(entry);
    size += entry.length;
  }
  flush();
  return chunks;
}

/** The static build's index.html with its stylesheet and module script inlined, and the data scripts ahead of it. */
async function pageHtml(dataScripts: string[], meta: { exportedAt: string; workspace: string }): Promise<string> {
  let html = await fs.readFile(path.join(STATIC_DIR, "index.html"), "utf-8").catch(() => {
    throw new Error(`no static dashboard build at ${STATIC_DIR}: run \`pnpm build:demo\``);
  });
  const css = html.match(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"[^>]*>/);
  const js = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/);
  if (!css || !js) throw new Error("the static dashboard build's index.html has an unexpected shape");
  const style = await fs.readFile(path.join(STATIC_DIR, css[1]), "utf-8");
  const code = await fs.readFile(path.join(STATIC_DIR, js[1]), "utf-8");
  const head = [
    `<script>window.__AGENTEVAL_SNAPSHOT_META__=${scriptSafe(JSON.stringify(meta))};</script>`,
    ...dataScripts.map((src) => `<script src="${src}"></script>`),
  ].join("\n");
  html = html.replace(css[0], () => `<style>${style}</style>`);
  html = html.replace(js[0], () => `${head}\n<script type="module">${code.replace(/<\/(script)/gi, "<\\/$1")}</script>`);
  return html;
}

export async function exportDashboard(ws: Workspace, outDir: string): Promise<ExportResult> {
  const server = createDemoServer(ws);
  const base = await listenDemo(server, 0);
  try {
    const responses = new Map<string, Recorded>();
    const rec: Recording = { into: responses, scrub: scrubber(ws.root), skipped: [], redacted: 0 };
    await record(base, ["/api/catalog", "/api/overview"], rec);
    const { catalog, skipped: byName } = withoutSecrets(JSON.parse(responses.get("/api/catalog")!.body) as CatalogShape);
    await record(base, urlsFor(catalog), rec);
    // A file dropped for its content leaves the file list too.
    const dropped = new Set(rec.skipped);
    const listed = { ...catalog, tasks: catalog.tasks.map((t) => ({ ...t, files: (t.files ?? []).filter((f) => !dropped.has(`${t.name}/${f}`)) })) };
    responses.set("/api/catalog", { status: 200, body: JSON.stringify(listed) });
    const skipped = [...byName, ...rec.skipped];

    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(path.join(outDir, "data"), { recursive: true });
    const chunks = chunkScripts(responses);
    const dataScripts = chunks.map((_, i) => `data/snapshot-${i + 1}.js`);
    await Promise.all(chunks.map((c, i) => fs.writeFile(path.join(outDir, dataScripts[i]), c, "utf-8")));

    const reports = reportFiles(catalog);
    for (const r of reports) {
      const res = await fetch(base + r.url);
      if (!res.ok) continue;
      const file = path.join(outDir, r.rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const { text, count } = redactSecrets(rec.scrub(await res.text()));
      rec.redacted += count;
      await fs.writeFile(file, text, "utf-8");
    }

    const meta = { exportedAt: new Date().toISOString(), workspace: path.basename(ws.root) };
    await fs.writeFile(path.join(outDir, "index.html"), await pageHtml(dataScripts, meta), "utf-8");
    const bytes = chunks.reduce((n, c) => n + Buffer.byteLength(c), 0);
    return { outDir, responses: responses.size, reports: reports.length, bytes, skipped, redacted: rec.redacted };
  } finally {
    server.close();
  }
}
