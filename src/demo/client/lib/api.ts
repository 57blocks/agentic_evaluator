/**
 * Every call the dashboard makes to its own server, in one place.
 *
 * The routes are the demo server's, and the path builders here are the only
 * thing that knows their shape — a component asks for "this run's
 * scores.jsonl", not for a URL. Errors are thrown rather than swallowed, so a
 * page decides what an unreadable file means; only `getTextOrNull` treats a
 * miss as an answer, because an artifact a run never wrote is normal.
 */

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

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`);
  return (await res.json()) as T;
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
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("连不上看板服务（agenteval dash 还在跑吗？）");
  }
  if (res.status === 404) throw new Error("服务器上没有这个文件");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Text, or null when the file is not there. */
export async function getTextOrNull(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: (await res.json()) as T & { error?: string } };
}

export async function del(url: string): Promise<void> {
  await fetch(url, { method: "DELETE" });
}
