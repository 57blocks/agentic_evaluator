/**
 * Local demo server — browse specs and completed runs. Does not execute evals.
 *
 *   pnpm run demo
 *   open http://127.0.0.1:4173
 */

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fixturesDir } from "../paths.js";
import { findWorkspace, runsDir, tasksDir, type Workspace } from "../core/workspace.js";
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

async function handle(ws: Workspace, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
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
  if (url.pathname === "/api/catalog") {
    // `tasks` is what the UI renders; `specs`/`runs` stay as the flat views
    // for anything reading the catalog directly.
    const [{ tasks, unfiled }, specs, runs] = await Promise.all([listTasks({ ws }), listSpecs({ ws }), listRuns({ ws })]);
    sendJson(res, 200, { tasks, unfiled, specs, runs });
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
  const resolved = ws ? Promise.resolve(ws) : findWorkspace();
  return http.createServer((req, res) => {
    resolved.then((w) => handle(w, req, res)).catch((err) => {
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
