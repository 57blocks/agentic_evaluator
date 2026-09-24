/**
 * The dashboard server.
 *
 *   agenteval dash
 *   open http://127.0.0.1:4173
 *
 * Reads the workspace it was started with, and can start a run in it. Binds
 * to loopback only and takes no credentials: it is a single-person tool on
 * one machine, not a service, and pretending otherwise would mean shipping an
 * auth story nobody has reviewed.
 *
 * Starting a run spends money, so it goes through `RunRegistry`, which
 * refuses anything that does not echo the plan it was shown. See
 * `src/server/runs.ts`.
 */

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixturesDir } from "../paths.js";
import { findWorkspace, runsDir, tasksDir, type Workspace } from "../core/workspace.js";
import { AlreadyRunning, PlanMismatch, RunRegistry, type PlanAck } from "../server/runs.js";
import { buildOverview } from "../server/overview.js";
import { hasReport, loadReportModel } from "../report-model.js";
import { NoSuchSpecError } from "../core/workspace.js";
import { listRuns, listSpecs, listTasks, liveRunIndex, loadRun, safeId } from "./catalog.js";
import { demoPage, DIST_DIR } from "./ui.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/jsonl; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** A request body, capped: this server is local, but a cap costs nothing. */
const MAX_BODY_BYTES = 64 * 1024;

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

/** Validate at the boundary: a body from a browser is external input. */
function parseStart(body: unknown): { task: string; ack: PlanAck; html: boolean } {
  const b = body as Record<string, unknown> | null;
  const task = b?.task;
  const ack = b?.ack as Record<string, unknown> | undefined;
  if (typeof task !== "string" || task === "") throw new Error("task is required");
  if (!ack) throw new Error("ack is required — echo back the plan you were shown");
  const num = (v: unknown, name: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`ack.${name} must be a number`);
    return v;
  };
  const budget = ack.budgetUsd;
  if (budget !== null && typeof budget !== "number") throw new Error("ack.budgetUsd must be a number or null");
  return {
    task,
    ack: {
      generations: num(ack.generations, "generations"),
      judgeCalls: num(ack.judgeCalls, "judgeCalls"),
      scoreCalls: num(ack.scoreCalls, "scoreCalls"),
      budgetUsd: budget as number | null,
    },
    html: b?.html === true,
  };
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function isEnoent(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("ENOENT") || (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** Resolve `rel` under `root`, or null if it would escape. */
export function underRoot(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/**
 * Root a `/artifact/<kind>/<rel>` request resolves under.
 *
 * Runs no longer live under one directory — each task keeps its own `runs/` —
 * so the first segment of `rel` is looked up in the live run index and the
 * rest resolves under that run's own directory. The id must be one the index
 * actually lists, which is a stricter gate than the old containment check,
 * and `underRoot` still guards the remainder of the path.
 */
async function artifactRoot(ws: Workspace, kind: string, rel: string): Promise<{ root: string; rel: string } | null> {
  if (kind === "fixture") return { root: fixturesDir(), rel };
  if (kind === "task") {
    // tasks/<name>/<file>: the name must be a single safe segment, and the
    // rest resolves under that task dir. `runs/` is reachable this way too,
    // which is intended — a run's own files belong to its task.
    const [name, ...rest] = rel.split("/");
    if (!safeId(name)) return null;
    return { root: path.join(tasksDir(ws), name), rel: rest.join("/") };
  }
  if (kind !== "run") return null;
  const [runId, ...rest] = rel.split("/");
  const dir = (await liveRunIndex({ ws })).get(runId);
  if (dir) return { root: dir, rel: rest.join("/") };
  // No such run in the index: fall back to the legacy root so an old link
  // still 404s on a missing file rather than 403ing on a valid one.
  return { root: runsDir(ws), rel };
}

async function sendArtifact(ws: Workspace, res: http.ServerResponse, kind: string, rel: string): Promise<void> {
  const target = await artifactRoot(ws, kind, rel);
  const abs = target ? underRoot(target.root, target.rel) : null;
  if (!abs) {
    send(res, 403, "forbidden");
    return;
  }
  const st = await fs.stat(abs);
  if (!st.isFile()) {
    send(res, 404, "not found");
    return;
  }
  const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  send(res, 200, await fs.readFile(abs), type);
}

/**
 * A run directory's report, as the data both renderers read.
 *
 * The directory is resolved through the same gate an artifact request goes
 * through — the run id must be in the live index, and the rest must stay
 * under it — so this route can read nothing `/artifact/` could not already
 * serve. A directory that holds no report is a 404, not an empty page.
 */
async function sendReport(ws: Workspace, res: http.ServerResponse, kind: string, rel: string): Promise<void> {
  const target = await artifactRoot(ws, kind, rel);
  const abs = target ? underRoot(target.root, target.rel) : null;
  if (!abs) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  if (!(await hasReport(abs))) {
    sendJson(res, 404, { error: "no run in this directory to build a report from" });
    return;
  }
  sendJson(res, 200, await loadReportModel(abs));
}

/**
 * Server-sent events for one run. Every event so far is replayed on connect,
 * so a page opened mid-run — or reconnected after a refresh — sees the whole
 * run rather than whatever happened to arrive after it showed up.
 */
function streamRun(runs: RunRegistry, res: http.ServerResponse, runId: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const unsubscribe = runs.subscribe(
    runId,
    (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    () => {
      const handle = runs.get(runId);
      res.write(`event: end\ndata: ${JSON.stringify(handle)}\n\n`);
      res.end();
    },
  );
  if (!unsubscribe) {
    sendJson(res, 404, { error: "run not found" });
    return;
  }
  res.on("close", unsubscribe);
}

async function handleRuns(
  runs: RunRegistry,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (events && req.method === "GET") {
    streamRun(runs, res, decodeURIComponent(events[1]));
    return true;
  }

  const one = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (one && req.method === "GET") {
    const handle = runs.get(decodeURIComponent(one[1]));
    if (!handle) sendJson(res, 404, { error: "run not found" });
    else sendJson(res, 200, handle);
    return true;
  }
  if (one && req.method === "DELETE") {
    const stopped = runs.cancel(decodeURIComponent(one[1]));
    if (!stopped) sendJson(res, 409, { error: "no such run in flight" });
    else sendJson(res, 200, runs.get(decodeURIComponent(one[1])));
    return true;
  }

  if (url.pathname === "/api/runs" && req.method === "GET") {
    sendJson(res, 200, { active: runs.active, runs: runs.list() });
    return true;
  }
  if (url.pathname === "/api/runs" && req.method === "POST") {
    try {
      const start = parseStart(await readJsonBody(req));
      sendJson(res, 201, await runs.start(start));
    } catch (err) {
      if (err instanceof PlanMismatch) {
        // 409, with what the plan says now: the page re-renders the numbers
        // and a human confirms them again. Never start on a stale promise.
        sendJson(res, 409, { error: err.message, ack: err.current });
      } else if (err instanceof AlreadyRunning) {
        sendJson(res, 409, { error: err.message, runId: err.runId });
      } else if (err instanceof NoSuchSpecError) {
        sendJson(res, 404, { error: err.message });
      } else {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    return true;
  }

  // The plan a caller must acknowledge before POSTing, computed from disk.
  const plan = url.pathname.match(/^\/api\/plan\/(.+)$/);
  if (plan && req.method === "GET") {
    try {
      const { plan: full, ack } = await runs.planFor(decodeURIComponent(plan[1]));
      sendJson(res, 200, { plan: full, ack });
    } catch (err) {
      sendJson(res, err instanceof NoSuchSpecError ? 404 : 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }
  return false;
}

async function handle(
  ws: Workspace,
  runs: RunRegistry,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  if (await handleRuns(runs, req, res, url)) return;
  if (req.method !== "GET") {
    send(res, 405, "method not allowed");
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(res, 200, await demoPage(), "text/html; charset=utf-8");
    return;
  }
  // Bundled client assets (hashed js/css/maps) sit beside index.html.
  if (url.pathname.startsWith("/assets/")) {
    const abs = underRoot(DIST_DIR, url.pathname.slice(1));
    if (!abs) {
      send(res, 403, "forbidden");
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
    send(res, 200, await fs.readFile(abs), type);
    return;
  }
  if (url.pathname === "/api/overview") {
    sendJson(res, 200, await buildOverview(ws));
    return;
  }
  if (url.pathname === "/api/catalog") {
    // `tasks` is what the UI renders; `specs`/`runs` stay as the flat views
    // for anything reading the catalog directly.
    const [{ tasks, unfiled, broken }, specs, runs] = await Promise.all([listTasks({ ws }), listSpecs({ ws }), listRuns({ ws })]);
    sendJson(res, 200, { tasks, unfiled, broken, specs, runs });
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/run\/([^/]+)$/);
  if (runMatch) {
    const view = await loadRun(decodeURIComponent(runMatch[1]), { ws });
    if (!view) {
      sendJson(res, 404, { error: "run not found" });
      return;
    }
    sendJson(res, 200, view);
    return;
  }
  const report = url.pathname.match(/^\/api\/report\/(run|fixture|task)\/(.+)$/);
  if (report) {
    await sendReport(ws, res, report[1], decodeURIComponent(report[2]));
    return;
  }
  const art = url.pathname.match(/^\/artifact\/(run|fixture|task)\/(.+)$/);
  if (art) {
    await sendArtifact(ws, res, art[1], decodeURIComponent(art[2]));
    return;
  }
  send(res, 404, "not found");
}

/**
 * `ws` is resolved once, at construction: every request then answers about the
 * same workspace, rather than about whatever directory the process happens to
 * be in when a request lands.
 */
export function createDemoServer(ws?: Workspace): http.Server {
  const resolved = (ws ? Promise.resolve(ws) : findWorkspace()).then((w) => ({ ws: w, runs: new RunRegistry(w) }));
  return http.createServer((req, res) => {
    resolved.then(({ ws: w, runs }) => handle(w, runs, req, res)).catch((err) => {
      if (isEnoent(err)) {
        send(res, 404, "not found");
        return;
      }
      send(res, 500, err instanceof Error ? err.message : String(err));
    });
  });
}

export function listenDemo(server: http.Server, port = PORT): Promise<string> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.removeListener("error", onError);
      const addr = server.address();
      const actual = addr && typeof addr === "object" ? addr.port : port;
      resolve(`http://${HOST}:${actual}`);
    });
  });
}

async function main(): Promise<void> {
  const server = createDemoServer(await findWorkspace());
  const url = await listenDemo(server);
  console.log(`Demo UI ${url}  (Ctrl+C to stop)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
