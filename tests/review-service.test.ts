/**
 * The review service against a real run: the free custom-check sample, run
 * offline, with an evaluators.human block added to its spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/index.js";
import { bufferIo } from "../src/cli/io.js";
import { loadReviewSession, recordVerdict, reveal } from "../src/core/review-service.js";
import { workspaceAt } from "../src/core/workspace.js";
import { createDemoServer, listenDemo } from "../src/demo/server.js";

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");
const HUMAN = "  human:\n    rubric_file: rubrics/notes.md\n    show: [RELEASE_NOTES.md]\n    dimensions: [completeness, clarity]\n";

/** A workspace holding custom-check (with a human block) and one finished run of it. */
async function reviewedTaskRun(human: string | null = HUMAN): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "review-svc-"));
  const task = path.join(ws, "tasks", "notes");
  await fs.cp(SAMPLE, task, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  if (human !== null) {
    const spec = path.join(task, "spec.yaml");
    await fs.writeFile(spec, (await fs.readFile(spec, "utf-8")).replace("  judge:\n", `${human}  judge:\n`));
  }
  const code = await main(["run", "notes", "--yes", "--plain", "--workspace", ws], bufferIo());
  assert.equal(code, 0);
  const [run] = await fs.readdir(path.join(task, "runs"));
  return path.join(task, "runs", run);
}

test("the session offers failed-check pairs only on request, and says how many it hid", async () => {
  const run = await reviewedTaskRun();

  const hidden = await loadReviewSession(run, "xing");
  const all = await loadReviewSession(run, "xing", { includeFailed: true });

  assert.equal(hidden.pairs.length, 0);
  assert.equal(hidden.hiddenFailed, 1);
  assert.equal(all.pairs.length, 1);
});

test("a pair carries the input and both answers' shown files, and no candidate id anywhere", async () => {
  const run = await reviewedTaskRun();

  const session = await loadReviewSession(run, "xing", { includeFailed: true });
  const [pair] = session.pairs;

  assert.deepEqual(session.dimensions, ["completeness", "clarity"]);
  assert.match(session.rubric.text, /\S/);
  assert.match(pair.input.text, /#\d+ /);
  assert.deepEqual(pair.left.files.map((f) => f.path), ["RELEASE_NOTES.md"]);
  assert.deepEqual(pair.right.files.map((f) => f.path), ["RELEASE_NOTES.md"]);
  assert.doesNotMatch(JSON.stringify(session), /careful|sloppy/);
});

test("a verdict is stored unblinded, and the session shows it back as the reviewer gave it", async () => {
  const run = await reviewedTaskRun();
  const [pair] = (await loadReviewSession(run, "xing", { includeFailed: true })).pairs;

  await recordVerdict(run, { reviewer: "xing", pairId: pair.id, overall: "left", dimensions: { clarity: "right" }, note: "fuller" });
  const again = await loadReviewSession(run, "xing", { includeFailed: true });

  assert.deepEqual(again.pairs[0].verdict, { overall: "left", dimensions: { clarity: "right" }, note: "fuller" });
  assert.equal(again.done, 1);
  const files = await fs.readdir(path.join(run, "reviews"));
  assert.equal(files.length, 1);
  const row = JSON.parse((await fs.readFile(path.join(run, "reviews", files[0]), "utf-8")).trim());
  assert.equal(row.evaluator, "human-pairwise");
  assert.ok(["careful", "sloppy"].includes(row.shown_as.left));
});

test("bad verdicts are refused", async () => {
  const run = await reviewedTaskRun();
  const [pair] = (await loadReviewSession(run, "xing", { includeFailed: true })).pairs;

  await assert.rejects(recordVerdict(run, { reviewer: "xing", pairId: pair.id, overall: "middle" as never }), /overall/);
  await assert.rejects(recordVerdict(run, { reviewer: "xing", pairId: pair.id, overall: "tie", dimensions: { tone: "left" } }), /tone/);
  await assert.rejects(recordVerdict(run, { reviewer: "xing", pairId: "nope", overall: "tie" }), /pair/);
  await assert.rejects(recordVerdict(run, { reviewer: "", pairId: pair.id, overall: "tie" }), /reviewer/);
});

test("revealing unblinds the session and freezes that reviewer's verdicts", async () => {
  const run = await reviewedTaskRun();
  const [pair] = (await loadReviewSession(run, "xing", { includeFailed: true })).pairs;
  await recordVerdict(run, { reviewer: "xing", pairId: pair.id, overall: "tie" });

  await reveal(run, "xing");
  const after = await loadReviewSession(run, "xing", { includeFailed: true });

  assert.equal(after.revealed, true);
  assert.deepEqual([after.pairs[0].revealed?.left, after.pairs[0].revealed?.right].sort(), ["careful", "sloppy"]);
  await assert.rejects(recordVerdict(run, { reviewer: "xing", pairId: pair.id, overall: "left" }), /revealed/);
  // Another reviewer is still blind.
  assert.equal((await loadReviewSession(run, "kevin", { includeFailed: true })).revealed, false);
});

test("a reviewer name cannot write outside reviews/", async () => {
  const run = await reviewedTaskRun();
  const [pair] = (await loadReviewSession(run, "x", { includeFailed: true })).pairs;

  await recordVerdict(run, { reviewer: "../../evil", pairId: pair.id, overall: "tie" });

  const files = await fs.readdir(path.join(run, "reviews"));
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /\.\.|\//);
});

test("a task that declares no human review says so", async () => {
  const run = await reviewedTaskRun(null);

  await assert.rejects(loadReviewSession(run, "xing"), /evaluators\.human/);
});

// ── over HTTP ─────────────────────────────────────────────────────────────

test("the dashboard serves the queue, takes verdicts and reveals, and 404s an unknown run", async () => {
  const run = await reviewedTaskRun();
  const ws = path.resolve(run, "..", "..", "..", "..");
  const server = createDemoServer(workspaceAt(ws));
  const base = await listenDemo(server, 0);
  const runId = path.basename(run);
  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const first = (await (await fetch(`${base}/api/review/${runId}?reviewer=xing&failed=1`)).json()) as { pairs: Array<{ id: string }> };
    const ok = await post(`${base}/api/review/${runId}`, { reviewer: "xing", pairId: first.pairs[0].id, overall: "right" });
    const bad = await post(`${base}/api/review/${runId}`, { reviewer: "xing", pairId: first.pairs[0].id, overall: "up" });
    const again = (await (await fetch(`${base}/api/review/${runId}?reviewer=xing&failed=1`)).json()) as { done: number };
    const revealed = await post(`${base}/api/review/${runId}/reveal`, { reviewer: "xing" });
    const missing = await fetch(`${base}/api/review/no-such-run?reviewer=xing`);

    assert.equal(ok.status, 200);
    assert.equal(bad.status, 400);
    assert.equal(again.done, 1);
    assert.equal(revealed.status, 200);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test("a cross-site page cannot post to the dashboard: wrong content type or foreign origin is refused", async () => {
  const run = await reviewedTaskRun();
  const ws = path.resolve(run, "..", "..", "..", "..");
  const server = createDemoServer(workspaceAt(ws));
  const base = await listenDemo(server, 0);
  const runId = path.basename(run);
  try {
    const { pairs } = (await (await fetch(`${base}/api/review/${runId}?reviewer=xing&failed=1`)).json()) as { pairs: Array<{ id: string }> };
    const body = JSON.stringify({ reviewer: "xing", pairId: pairs[0].id, overall: "left" });

    // The two shapes a cross-site form or fetch can send without a CORS preflight.
    const textPlain = await fetch(`${base}/api/review/${runId}`, { method: "POST", headers: { "content-type": "text/plain" }, body });
    const foreign = await fetch(`${base}/api/review/${runId}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
    const startRun = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    const sameOrigin = await fetch(`${base}/api/review/${runId}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body });

    assert.equal(textPlain.status, 415);
    assert.equal(foreign.status, 403);
    assert.equal(startRun.status, 415);
    assert.equal(sameOrigin.status, 200);
    assert.equal(await fs.readdir(path.join(run, "reviews")).then((f) => f.length), 1);
  } finally {
    server.close();
  }
});

// ── `agenteval review` ───────────────────────────────────────────────────

test("agenteval review names the reviewer, links straight to the review page, and refuses a task with no human block", async () => {
  const { resolveReviewer, reviewPageUrl } = await import("../src/cli/commands/review.js");
  const run = await reviewedTaskRun(null);
  const ws = path.resolve(run, "..", "..", "..", "..");

  assert.equal(await resolveReviewer("Kevin"), "Kevin");
  assert.ok((await resolveReviewer(undefined)).length > 0);
  assert.equal(reviewPageUrl("http://127.0.0.1:4173", "run-1", "Xing Liu"), "http://127.0.0.1:4173/#run=run-1&review=Xing%20Liu");
  await assert.rejects(main(["review", path.basename(run), "--workspace", ws, "--no-open"], bufferIo()), /evaluators\.human/);
});

test("DNS rebinding: a request for a non-loopback host name is refused, GET and POST alike", async () => {
  const run = await reviewedTaskRun();
  const ws = path.resolve(run, "..", "..", "..", "..");
  const server = createDemoServer(workspaceAt(ws));
  const base = await listenDemo(server, 0);
  const port = new URL(base).port;
  const raw = (method: string, host: string, extra: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: `/api/review/${path.basename(run)}?reviewer=x`, method, headers: { host, ...extra } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end(method === "POST" ? "{}" : undefined);
    });
  try {
    // The attacker's page and Host both say evil.example; it resolves to 127.0.0.1.
    assert.equal(await raw("GET", `evil.example:${port}`), 403);
    assert.equal(await raw("POST", `evil.example:${port}`, { "content-type": "application/json", origin: `http://evil.example:${port}` }), 403);
    assert.equal(await raw("GET", `localhost:${port}`), 200);
    assert.equal(await raw("GET", `127.0.0.1:${port}`), 200);
  } finally {
    server.close();
  }
});

test("a file under the cap is whole, even when it is mostly multi-byte text", async () => {
  const { capText } = await import("../src/core/review-service.js");
  const cjk = Buffer.from("新增一个 platform 基座域 → foundation\n".repeat(200), "utf-8");

  const whole = capText(cjk, 512 * 1024);
  const cut = capText(cjk, 100);

  assert.equal(whole.truncated, false);
  assert.equal(whole.content, cjk.toString("utf-8"));
  assert.equal(cut.truncated, true);
  assert.ok(Buffer.byteLength(cut.content, "utf-8") <= 100);
  assert.doesNotMatch(cut.content, /�/);
});
