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
import { REPO_ROOT, runsDir } from "../paths.js";
import { listRuns, listSpecs, loadRun } from "./catalog.js";
import { demoPage } from "./ui.js";

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

function artifactRoot(kind: string): string | null {
  if (kind === "run") return runsDir();
  if (kind === "fixture") return path.join(REPO_ROOT, "fixtures");
  return null;
}

async function sendArtifact(res: http.ServerResponse, kind: string, rel: string): Promise<void> {
  const root = artifactRoot(kind);
  const abs = root ? underRoot(root, rel) : null;
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

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  if (req.method !== "GET") {
    send(res, 405, "method not allowed");
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(res, 200, demoPage(), "text/html; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/catalog") {
    const [specs, runs] = await Promise.all([listSpecs(), listRuns()]);
    sendJson(res, 200, { specs, runs });
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/run\/([^/]+)$/);
  if (runMatch) {
    const view = await loadRun(decodeURIComponent(runMatch[1]));
    if (!view) {
      sendJson(res, 404, { error: "run not found" });
      return;
    }
    sendJson(res, 200, view);
    return;
  }
  const art = url.pathname.match(/^\/artifact\/(run|fixture)\/(.+)$/);
  if (art) {
    await sendArtifact(res, art[1], decodeURIComponent(art[2]));
    return;
  }
  send(res, 404, "not found");
}

export function createDemoServer(): http.Server {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
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
  const server = createDemoServer();
  const url = await listenDemo(server);
  console.log(`Demo UI ${url}  (Ctrl+C to stop)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
