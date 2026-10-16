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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer, listenDemo } from "./server.js";
import { artifactUrl, reportUrl, taskFileUrl } from "./client/lib/api.js";
import type { Workspace } from "../core/workspace.js";
import type { RunView, TaskView } from "./catalog.js";

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "demo-static");

/** Evidence files a run page reads from each step (client/features/evidence). */
const EVIDENCE_FILES = ["scores.jsonl", "evaluations.jsonl", "GAPS.md"];

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
}

interface CatalogShape {
  tasks: TaskView[];
  unfiled?: RunView[];
}

async function record(base: string, urls: Iterable<string>, into: Map<string, Recorded>): Promise<void> {
  for (const url of urls) {
    if (into.has(url)) continue;
    const res = await fetch(base + url);
    into.set(url, { status: res.status, body: await res.text() });
  }
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
    await record(base, ["/api/catalog", "/api/overview"], responses);
    const catalog = JSON.parse(responses.get("/api/catalog")!.body) as CatalogShape;
    await record(base, urlsFor(catalog), responses);

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
      await fs.writeFile(file, await res.text(), "utf-8");
    }

    const meta = { exportedAt: new Date().toISOString(), workspace: path.basename(ws.root) };
    await fs.writeFile(path.join(outDir, "index.html"), await pageHtml(dataScripts, meta), "utf-8");
    const bytes = chunks.reduce((n, c) => n + Buffer.byteLength(c), 0);
    return { outDir, responses: responses.size, reports: reports.length, bytes };
  } finally {
    server.close();
  }
}
