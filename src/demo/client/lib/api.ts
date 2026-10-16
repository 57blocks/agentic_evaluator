/**
 * Every call the dashboard makes to its own server, in one place.
 *
 * The routes are the demo server's, and the path builders here are the only
 * thing that knows their shape — a component asks for "this run's
 * scores.jsonl", not for a URL. Errors are thrown rather than swallowed, so a
 * page decides what an unreadable file means; only `getTextOrNull` treats a
 * miss as an answer, because an artifact a run never wrote is normal.
 */

import { isSnapshot, READ_ONLY, snapshotResponse } from "./snapshot";

/** Percent-encode each segment but keep the separators. */
function encodePath(rel: string): string {
  return rel.split("/").map(encodeURIComponent).join("/");
}

/** A file inside one step's run directory. */
export function artifactUrl(stepDir: string, name: string): string {
  return `/artifact/${stepDir}/${name}`;
}

/** The report model for an artifact-relative run or step directory. */
export function reportUrl(dir: string): string {
  return `/api/report/${encodePath(dir)}`;
}

/** A file inside a task's definition directory. */
export function taskFileUrl(task: string, rel: string): string {
  return `/artifact/task/${encodeURIComponent(task)}/${encodePath(rel)}`;
}

/** A GET: from the export's snapshot when the page is one, else from the server. */
async function read(url: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  if (isSnapshot()) {
    const hit = snapshotResponse(url);
    return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, text: async () => hit.body };
  }
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, text: () => res.text() };
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await read(url);
  if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`);
  return JSON.parse(await res.text()) as T;
}

/**
 * Text, and a thrown error for anything else.
 *
 * Use this where the caller was told the file exists — a task's own
 * definition, listed by the catalog. A miss there is worth a distinct
 * message: "the server is not answering" and "that file is gone" send a
 * reader to very different places.
 */
export async function getText(url: string): Promise<string> {
  let res: Awaited<ReturnType<typeof read>>;
  try {
    res = await read(url);
  } catch {
    throw new Error("Cannot reach the dashboard server (is agenteval dash still running?)");
  }
  if (res.status === 404) throw new Error(isSnapshot() ? "That file is not in this export" : "That file is not on the server");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Text, or null when the file is not there. */
export async function getTextOrNull(url: string): Promise<string | null> {
  try {
    const res = await read(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export interface JsonResponse<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

/** POST that hands back the status too: the run API answers 409 with data. */
export async function postJson<T>(url: string, payload: unknown): Promise<JsonResponse<T>> {
  if (isSnapshot()) throw new Error(READ_ONLY);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: (await res.json()) as T & { error?: string } };
}

export async function del(url: string): Promise<void> {
  if (isSnapshot()) throw new Error(READ_ONLY);
  await fetch(url, { method: "DELETE" });
}

// ── blind human review ───────────────────────────────────────────────────────

/** Mirrors core/review-service.ts's ReviewSession; the browser never sees candidate ids before reveal. */
export type ScreenVerdict = "left" | "right" | "tie" | "both_bad";

export interface ReviewSession {
  run: string;
  step: string;
  reviewer: string;
  rubric: { file: string; text: string; sha: string };
  dimensions: string[];
  pairs: Array<{
    id: string;
    input: { slug: string; text: string };
    left: { files: Array<{ path: string; content: string; truncated: boolean }> };
    right: { files: Array<{ path: string; content: string; truncated: boolean }> };
    verdict: { overall: ScreenVerdict; dimensions: Record<string, ScreenVerdict>; note: string } | null;
    revealed?: { left: string; right: string };
  }>;
  done: number;
  hiddenFailed: number;
  revealed: boolean;
}

export function reviewUrl(runId: string, reviewer: string, includeFailed: boolean): string {
  const q = new URLSearchParams({ reviewer, ...(includeFailed ? { failed: "1" } : {}) });
  return `/api/review/${encodeURIComponent(runId)}?${q}`;
}

/** A review POST: 400 carries the server's reason, which the page shows as is. */
async function postReview(url: string, body: unknown): Promise<void> {
  const res = await postJson<unknown>(url, body);
  if (!res.ok) throw new Error(res.body.error ?? `HTTP ${res.status}`);
}

export function postVerdict(
  runId: string,
  verdict: { reviewer: string; pairId: string; overall: ScreenVerdict; dimensions: Record<string, ScreenVerdict>; note: string },
): Promise<void> {
  return postReview(`/api/review/${encodeURIComponent(runId)}`, verdict);
}

export function postReveal(runId: string, reviewer: string): Promise<void> {
  return postReview(`/api/review/${encodeURIComponent(runId)}/reveal`, { reviewer });
}
