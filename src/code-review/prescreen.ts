/**
 * An optional first pass over mined candidates: show a model the introducing
 * and fixing commits and ask whether the introducing change shipped a real
 * defect. The verdict helps a person read the table faster; it is never the
 * label (`build` takes only what a person confirmed, unless told otherwise,
 * and then says so).
 *
 * Calls go through agenteval's provider plumbing (src/llm.ts: OpenRouter by
 * default, key from the environment or .env.local, never printed).
 */

import { complete } from "../llm.js";
import { git } from "./git.js";
import { mapPool } from "./mine.js";
import { CATEGORIES, SEVERITIES, type Candidate, type MinedFile, type Prescreen } from "./types.js";

const MAX_DIFF_CHARS = 14_000;
const MAX_TOKENS = 2000;
const CONCURRENCY = 4;

export type Completer = (req: { system: string; prompt: string }) => Promise<{ text: string; costUsd: number }>;

export function openRouterCompleter(model: string): Completer {
  return async ({ system, prompt }) => {
    const r = await complete({ model, system, prompt, temperature: 0, maxTokens: MAX_TOKENS });
    return { text: r.text, costUsd: r.costUsd };
  };
}

export function systemPrompt(repo: string): string {
  return `You are screening candidate bugs for a code-review benchmark built from the history of ${repo}.

A script paired a FIX commit with the commit that last touched the lines the
fix removed (the INTRODUCING commit), which landed through a different change.
Decide whether the introducing change shipped a real defect.

A defect means the introducing change made the software behave wrongly at the
time it merged: a wrong amount, rate, rule or condition; a crash; a broken
flow or state; lost or corrupted data; a security or privacy problem; a race;
a leak; a broken accessibility contract (e.g. duplicate ids). NOT a defect: a
later product or legal change, a new requirement, wording or typos, styling
or layout preference, a refactor, a rename, a dependency bump, or a fix whose
blamed lines are unrelated to the bug.

Answer with one JSON object only:
{
  "verdict": "defect" | "not_defect" | "unsure",
  "category": ${CATEGORIES.map((c) => `"${c}"`).join(" | ")},
  "severity": ${SEVERITIES.map((s) => `"${s}"`).join(" | ")},
  "visible_in_introducing_diff": true | false,
  "defect": "<one sentence, as a reviewer would flag it on the introducing change>",
  "file": "<path of the faulty code in the introducing commit>",
  "confidence": <0..1>,
  "reason": "<one or two sentences>"
}`;
}

function clip(text: string): string {
  return text.length <= MAX_DIFF_CHARS ? text : `${text.slice(0, MAX_DIFF_CHARS)}\n[... truncated]`;
}

async function packet(repo: string, c: Candidate): Promise<string> {
  const intro = c.introducing.sha;
  const introFiles = [...new Set(c.blamed.filter((b) => b.sha === intro).map((b) => b.orig_file))];
  const unit = c.introducing.unit;
  const show = (sha: string) => git(repo, ["show", "-s", "--format=%h %ad%n%B", "--date=short", "--end-of-options", sha]);
  const diff = (sha: string, files: readonly string[]) => git(repo, ["show", "--format=", "--no-color", "--no-ext-diff", "--end-of-options", sha, "--", ...files]);
  return [
    unit.kind === "pr" ? `INTRODUCING PR #${unit.number}: ${unit.title}` : `INTRODUCING CHANGE: ${unit.title}`,
    `INTRODUCING COMMIT:\n${(await show(intro)).trim()}`,
    `INTRODUCING DIFF (the blamed files only):\n${clip(await diff(intro, introFiles))}`,
    `FIX COMMIT:\n${(await show(c.fix.sha)).trim()}`,
    `FIX DIFF:\n${clip(await diff(c.fix.sha, c.files))}`,
  ].join("\n\n");
}

const VERDICTS = new Set(["defect", "not_defect", "unsure"]);

export function parseVerdict(text: string, model: string, costUsd: number): Prescreen {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return { model, verdict: "error", reason: "the reply held no JSON object", cost_usd: costUsd };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { model, verdict: "error", reason: "the reply's JSON did not parse", cost_usd: costUsd };
  }
  if (!VERDICTS.has(String(raw.verdict))) return { model, verdict: "error", reason: `unknown verdict ${JSON.stringify(raw.verdict)}`, cost_usd: costUsd };
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  return {
    model,
    verdict: raw.verdict as Prescreen["verdict"],
    ...(str("category") ? { category: str("category") } : {}),
    ...(str("severity") ? { severity: str("severity") } : {}),
    ...(typeof raw.visible_in_introducing_diff === "boolean" ? { visible_in_introducing_diff: raw.visible_in_introducing_diff } : {}),
    ...(str("defect") ? { defect: str("defect") } : {}),
    ...(str("file") ? { file: str("file") } : {}),
    ...(typeof raw.confidence === "number" ? { confidence: raw.confidence } : {}),
    ...(str("reason") ? { reason: str("reason") } : {}),
    cost_usd: costUsd,
  };
}

export interface PrescreenOptions {
  repo: string;
  model: string;
  /** Screen at most this many (not already screened by this model), in table order. */
  limit: number | null;
  completer?: Completer;
  log?: (line: string) => void;
}

/** The mined file with a `prescreen` on up to `limit` more candidates. */
export async function prescreen(mined: MinedFile, opts: PrescreenOptions): Promise<{ mined: MinedFile; screened: number; costUsd: number }> {
  const ask = opts.completer ?? openRouterCompleter(opts.model);
  const system = systemPrompt(mined.repo.github ?? "this repository");
  const todo = mined.candidates.filter((c) => c.prescreen?.model !== opts.model || c.prescreen.verdict === "error");
  const chosen = new Set((opts.limit === null ? todo : todo.slice(0, opts.limit)).map((c) => c.id));
  const verdicts = new Map<string, Prescreen>();
  await mapPool([...chosen], CONCURRENCY, async (id) => {
    const c = mined.candidates.find((x) => x.id === id)!;
    try {
      const reply = await ask({ system, prompt: await packet(opts.repo, c) });
      verdicts.set(id, parseVerdict(reply.text, opts.model, reply.costUsd));
    } catch (err) {
      verdicts.set(id, { model: opts.model, verdict: "error", reason: err instanceof Error ? err.message : String(err) });
    }
    opts.log?.(`screened ${id}: ${verdicts.get(id)!.verdict}`);
  });
  const candidates = mined.candidates.map((c) => (verdicts.has(c.id) ? { ...c, prescreen: verdicts.get(c.id)! } : c));
  const costUsd = [...verdicts.values()].reduce((sum, v) => sum + (v.cost_usd ?? 0), 0);
  return { mined: { ...mined, candidates }, screened: verdicts.size, costUsd };
}
