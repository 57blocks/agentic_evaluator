/**
 * Human review over a finished run, for the dashboard (docs/design/human-review.md).
 *
 * The browser never learns which candidate is which until the reviewer
 * reveals: a pair is an opaque id, its two answers are "left" and "right",
 * and their files are embedded here rather than linked (an artifact URL names
 * the candidate's work dir). Config comes from the task's current spec —
 * runs made before a task declared `evaluators.human` can still be reviewed —
 * and the rubric's hash versions every verdict.
 */

import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sha256, short } from "../canon/hash.js";
import type { RunManifest } from "../canon/manifest.js";
import type { TrialRow } from "../canon/rows.js";
import {
  blindLayout,
  latestVerdicts,
  matchesShow,
  pairId,
  reviewQueue,
  verdictRow,
  type BlindLayout,
  type HumanVerdict,
  type ReviewEntry,
  type ReviewItem,
  type ReviewRow,
  type ScreenVerdict,
} from "../canon/review.js";
import { taskInputPath } from "../paths.js";
import { loadWorkflow } from "../spec/load-spec.js";
import type { HumanReviewConfig } from "../types.js";
import { safeName } from "./generate.js";

/** Per-file and per-answer ceilings on embedded content: plans are KB, fixtures are not. */
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_CHARS = 2000;
const MAX_REVIEWER_CHARS = 64;
const SCREEN: ReadonlySet<string> = new Set(["left", "right", "tie", "both_bad"]);

export interface ShownFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ReviewPair {
  id: string;
  input: { slug: string; text: string };
  left: { files: ShownFile[] };
  right: { files: ShownFile[] };
  /** This reviewer's latest verdict, in screen terms; null when not yet reviewed. */
  verdict: { overall: ScreenVerdict; dimensions: Record<string, ScreenVerdict>; note: string } | null;
  /** Candidate ids, only once this reviewer has revealed. */
  revealed?: { left: string; right: string };
}

export interface ReviewSession {
  run: string;
  step: string;
  reviewer: string;
  rubric: { file: string; text: string; sha: string };
  dimensions: string[];
  pairs: ReviewPair[];
  done: number;
  /** Pairs left out because one side failed its required check. */
  hiddenFailed: number;
  revealed: boolean;
}

export interface VerdictInput {
  reviewer: string;
  pairId: string;
  overall: ScreenVerdict;
  dimensions?: Record<string, ScreenVerdict>;
  note?: string;
}

class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, "utf-8").catch(() => "");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
}

/** What review needs from a run and its task, resolved once per request. */
interface RunContext {
  runDir: string;
  runId: string;
  step: string;
  taskRoot: string;
  trials: TrialRow[];
  human: HumanReviewConfig;
  rubric: { file: string; text: string; sha: string };
}

async function runContext(runDir: string): Promise<RunContext> {
  const manifest = JSON.parse(await readFile(path.join(runDir, "manifest.json"), "utf-8")) as RunManifest;
  // A run lives at <task>/runs/<run>/; review reads the task's spec as it is now.
  const taskRoot = path.resolve(runDir, "..", "..");
  const suites = await loadWorkflow(path.join(taskRoot, "spec.yaml"));
  const suite = suites.find((s) => (s.stepId ?? s.step) === manifest.step.id);
  if (!suite?.human) {
    throw new ReviewError(`task ${path.basename(taskRoot)} declares no evaluators.human for step ${manifest.step.id}; add one to review this run`);
  }
  const rubricPath = path.resolve(taskRoot, suite.human.rubricFile);
  const text = await readFile(rubricPath, "utf-8").catch(() => {
    throw new ReviewError(`human review rubric ${suite.human!.rubricFile} not found`);
  });
  return {
    runDir,
    runId: manifest.run_id,
    step: manifest.step.id,
    taskRoot,
    trials: await readJsonl<TrialRow>(path.join(runDir, "scores.jsonl")),
    human: suite.human,
    rubric: { file: suite.human.rubricFile, text, sha: sha256(text) },
  };
}

/** A file name for a reviewer that cannot leave reviews/ and cannot collide by sanitising. */
function reviewerFile(reviewer: string): string {
  const slug = reviewer.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "reviewer";
  return `${slug}-${short(sha256(reviewer)).slice(0, 6)}.jsonl`;
}

function checkReviewer(reviewer: unknown): string {
  if (typeof reviewer !== "string" || reviewer.trim() === "" || reviewer.length > MAX_REVIEWER_CHARS) {
    throw new ReviewError(`reviewer must be a name of 1–${MAX_REVIEWER_CHARS} characters`);
  }
  return reviewer.trim();
}

async function entriesFor(runDir: string, reviewer: string): Promise<ReviewEntry[]> {
  return readJsonl<ReviewEntry>(path.join(runDir, "reviews", reviewerFile(reviewer)));
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
}

/** The files a reviewer compares for one trial: `show` globs, or the deliverable text. */
async function shownFiles(ctx: RunContext, candidate: string, input: string, trial: number): Promise<ShownFile[]> {
  const workDir = path.join(ctx.runDir, "checks", `${safeName(candidate)}__${input}__t${trial}`);
  const wanted = ctx.human.show.length > 0 ? ctx.human.show : ["output.txt"];
  const paths = (await filesUnder(workDir)).filter((rel) => matchesShow(rel, wanted));
  const out: ShownFile[] = [];
  let budget = MAX_ANSWER_BYTES;
  for (const rel of paths) {
    const abs = path.join(workDir, rel);
    const size = (await stat(abs)).size;
    const cap = Math.min(MAX_FILE_BYTES, budget);
    const content = cap > 0 ? (await readFile(abs, "utf-8")).slice(0, cap) : "";
    budget -= content.length;
    out.push({ path: rel, content, truncated: size > content.length });
  }
  return out;
}

function toScreen(v: HumanVerdict, layout: BlindLayout): ScreenVerdict {
  if (v === "tie" || v === "both_bad") return v;
  return v === layout.left ? "left" : "right";
}

function sides(item: ReviewItem, layout: BlindLayout): { left: { candidate: string; trial: number }; right: { candidate: string; trial: number } } {
  const a = { candidate: item.a, trial: item.trialA };
  const b = { candidate: item.b, trial: item.trialB };
  return layout.left === "a" ? { left: a, right: b } : { left: b, right: a };
}

export async function loadReviewSession(
  runDir: string,
  reviewerName: string,
  opts: { includeFailed?: boolean } = {},
): Promise<ReviewSession> {
  const reviewer = checkReviewer(reviewerName);
  const ctx = await runContext(runDir);
  const all = reviewQueue(ctx.trials, { includeFailed: true });
  const items = opts.includeFailed ? all : reviewQueue(ctx.trials);
  const entries = await entriesFor(runDir, reviewer);
  const revealed = entries.some((e) => e.kind === "reveal");
  const latest = new Map(latestVerdicts(entries).map((r) => [r.subject.kind === "pair" ? pairId(ctx.runId, r.subject) : "", r]));

  const inputText = new Map<string, string>();
  const pairs: ReviewPair[] = [];
  for (const item of items) {
    const id = pairId(ctx.runId, item);
    const layout = blindLayout(ctx.runId, reviewer, item);
    const { left, right } = sides(item, layout);
    if (!inputText.has(item.input)) {
      inputText.set(item.input, await readFile(taskInputPath(ctx.taskRoot, item.input), "utf-8").catch(() => ""));
    }
    const prior = latest.get(id);
    pairs.push({
      id,
      input: { slug: item.input, text: inputText.get(item.input) ?? "" },
      left: { files: await shownFiles(ctx, left.candidate, item.input, left.trial) },
      right: { files: await shownFiles(ctx, right.candidate, item.input, right.trial) },
      verdict: prior
        ? {
            overall: toScreen(prior.overall as HumanVerdict, layout),
            dimensions: Object.fromEntries(Object.entries(prior.dimensions ?? {}).map(([k, v]) => [k, toScreen(v as HumanVerdict, layout)])),
            note: prior.evidence ?? "",
          }
        : null,
      ...(revealed ? { revealed: { left: left.candidate, right: right.candidate } } : {}),
    });
  }
  return {
    run: ctx.runId,
    step: ctx.step,
    reviewer,
    rubric: ctx.rubric,
    dimensions: ctx.human.dimensions,
    pairs,
    done: pairs.filter((p) => p.verdict !== null).length,
    hiddenFailed: all.length - items.length,
    revealed,
  };
}

export async function recordVerdict(runDir: string, input: VerdictInput): Promise<ReviewRow> {
  const reviewer = checkReviewer(input.reviewer);
  if (!SCREEN.has(input.overall)) throw new ReviewError(`overall must be one of ${[...SCREEN].join(", ")}`);
  const ctx = await runContext(runDir);
  for (const [dim, v] of Object.entries(input.dimensions ?? {})) {
    if (!ctx.human.dimensions.includes(dim)) throw new ReviewError(`unknown dimension ${dim}; this review has ${ctx.human.dimensions.join(", ") || "none"}`);
    if (!SCREEN.has(v)) throw new ReviewError(`dimension ${dim} must be one of ${[...SCREEN].join(", ")}`);
  }
  const note = typeof input.note === "string" ? input.note.slice(0, MAX_NOTE_CHARS) : undefined;
  if ((await entriesFor(runDir, reviewer)).some((e) => e.kind === "reveal")) {
    throw new ReviewError(`${reviewer} has revealed this run; verdicts are read-only now`);
  }
  const item = reviewQueue(ctx.trials, { includeFailed: true }).find((i) => pairId(ctx.runId, i) === input.pairId);
  if (!item) throw new ReviewError(`no pair ${input.pairId} in this run`);
  const row = verdictRow({
    run: ctx.runId,
    step: ctx.step,
    rubricSha: ctx.rubric.sha,
    reviewer,
    item,
    layout: blindLayout(ctx.runId, reviewer, item),
    overall: input.overall,
    dimensions: input.dimensions,
    note,
  });
  await mkdir(path.join(runDir, "reviews"), { recursive: true });
  await appendFile(path.join(runDir, "reviews", reviewerFile(reviewer)), `${JSON.stringify(row)}\n`, "utf-8");
  return row;
}

/** Unblind this run for one reviewer; their verdicts become read-only. */
export async function reveal(runDir: string, reviewerName: string): Promise<void> {
  const reviewer = checkReviewer(reviewerName);
  await runContext(runDir);
  await mkdir(path.join(runDir, "reviews"), { recursive: true });
  const entry: ReviewEntry = { kind: "reveal", reviewer, at: new Date().toISOString() };
  await appendFile(path.join(runDir, "reviews", reviewerFile(reviewer)), `${JSON.stringify(entry)}\n`, "utf-8");
}

export { ReviewError };
