/**
 * Absolute (reference-free) scoring — the complement to pairwise judging.
 *
 * The judge reads ONE output plus the rubric and grades it 1–5 on each
 * dimension (and overall), against fixed anchors. Unlike a pairwise winner this
 * preserves MAGNITUDE: a strong-but-second output scores ~4, not "0 wins". It's
 * O(n) — one call per output — so far cheaper than the O(n²) pairwise pass, and
 * it can be re-run over frozen raw outputs with no regeneration.
 *
 * Absolute LLM scores are prone to clustering / miscalibration, so the prompt
 * (a) gives explicit 1–5 anchors, (b) forces a per-dimension reason, and (c)
 * tells the grader to use the full range and not default to 4.
 */

import { complete, LlmError, type LlmTrace } from "./llm.js";
import { sha256 } from "./canon/hash.js";
import {
  attemptFrom,
  EvaluatorCallError,
  summarizeAttempts,
  type AttemptUsage,
  type EvaluatorUsage,
} from "./canon/usage.js";

export const ABSOLUTE_EVALUATOR_ID = "absolute-1-5";

/** A 1–5 grade per dimension key, plus an overall 1–5. */
export interface AbsoluteScore {
  dimensions: Record<string, number>;
  overall: number;
}

/** A grade plus what it cost to obtain (all attempts). */
export type ScoredOutput = AbsoluteScore & { usage: EvaluatorUsage };

/** Hash of the scorer prompt template with the rubric — part of the evaluator version. */
export function scorePromptTemplateSha(rubric: string, dimensions: readonly string[]): string {
  return sha256(buildPrompt(rubric, dimensions, "{{OUTPUT}}"));
}

const MIN_SCORE = 1;
const MAX_SCORE = 5;

const ANCHORS = [
  "5 — excellent: fully meets this dimension's bar, no meaningful issues.",
  "4 — good: solid, only minor issues.",
  "3 — acceptable: usable but with real gaps.",
  "2 — weak: notable problems that would need rework.",
  "1 — poor: fails this dimension.",
].join("\n");

function buildPrompt(
  rubric: string,
  dimensions: readonly string[],
  text: string,
): string {
  const dimList =
    dimensions.length > 0
      ? dimensions.map((d) => `- "${d}"`).join("\n")
      : '(no named dimensions — score "overall" only)';
  const dimSchema =
    dimensions.length > 0
      ? dimensions
          .map((d) => `"${d}": {"score": <1-5>, "reason": "<cited evidence>"}`)
          .join(", ")
      : "";
  return [
    "You are a strict, calibrated grader scoring ONE output against a rubric.",
    "",
    "## Rubric",
    rubric.trim(),
    "",
    "## Scoring scale (1–5 — use the FULL range)",
    ANCHORS,
    "Be discriminating: reserve 5 for genuinely excellent work and 1 for genuine",
    "failure. Do NOT default to 4. Grade each dimension on its own merits.",
    "",
    "## Dimensions to score",
    dimList,
    "",
    "## Output to grade",
    text.trim(),
    "",
    "## Response",
    "Every reason must be CHECKABLE by someone holding the output: name the",
    "concrete thing you graded — a task id, requirement id, function, type, file",
    "or section — and say what the output did with it. Two to four sentences. A",
    'reason that only asserts a quality ("well structured", "thorough") without',
    "naming what in the output makes it so is invalid; so is a reason that cites",
    "something the output does not contain.",
    "",
    "Respond with ONLY a JSON object of exactly this shape:",
    `{"dimensions": {${dimSchema}}, "overall": {"score": <1-5>, "reason": "<cited evidence>"}}`,
  ].join("\n");
}

/** Clamp a parsed value into [1,5]; non-numbers → null. */
function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, value));
}

/** Read a score off either `5` or `{score:5,...}`; invalid → null. */
function parseScoreAxis(value: unknown): number | null {
  if (typeof value === "number") return clampScore(value);
  if (typeof value === "object" && value !== null) {
    return clampScore((value as Record<string, unknown>).score);
  }
  return null;
}

/**
 * Parse the grader JSON. Throws when no JSON object can be extracted or when the
 * overall score is missing/invalid (so `scoreAll`'s per-item try/catch skips it,
 * mirroring the judge). A missing dimension is simply omitted from `dimensions`.
 */
function parse(text: string, dimensions: readonly string[]): AbsoluteScore {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`scorer returned no JSON: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("scorer JSON is not an object");
  }
  const root = parsed as Record<string, unknown>;
  const rawDims =
    typeof root.dimensions === "object" && root.dimensions !== null
      ? (root.dimensions as Record<string, unknown>)
      : {};

  const dims: Record<string, number> = {};
  for (const key of dimensions) {
    const s = parseScoreAxis(rawDims[key]);
    if (s !== null) dims[key] = s;
  }
  const overall = parseScoreAxis(root.overall);
  if (overall === null) {
    throw new Error("scorer JSON missing a valid overall score");
  }
  return { dimensions: dims, overall };
}

/** Max grader attempts per output. Retries bump temperature to shake loose a
 *  different (hopefully valid) reply, same as the pairwise judge. */
const MAX_ATTEMPTS = 3;

/**
 * Grade one output 1–5 per dimension + overall. Retries on parse failure.
 * Throws `EvaluatorCallError` (with every billed attempt) when all attempts fail.
 */
export async function scoreOne(params: {
  judgeModel: string;
  rubric: string;
  dimensions: readonly string[];
  text: string;
  timeoutMs?: number;
  trace?: LlmTrace;
  traceContext?: Record<string, unknown>;
}): Promise<ScoredOutput> {
  const prompt = buildPrompt(params.rubric, params.dimensions, params.text);
  const attempts: AttemptUsage[] = [];
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const r = await complete({
        model: params.judgeModel,
        prompt,
        temperature: attempt === 0 ? 0 : 0.3,
        timeoutMs: params.timeoutMs,
        jsonMode: true,
        maxTokens: 4000,
        trace: params.trace,
        traceContext: { ...params.traceContext, phase: "score", attempt },
      });
      try {
        const graded = parse(r.text, params.dimensions);
        attempts.push(attemptFrom(r, r.ms, true));
        return { ...graded, usage: summarizeAttempts(attempts) };
      } catch (parseErr) {
        attempts.push(attemptFrom(r, r.ms, false));
        lastErr = parseErr;
      }
    } catch (err) {
      if (err instanceof LlmError) attempts.push(attemptFrom(err.usage, err.ms, false));
      lastErr = err;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new EvaluatorCallError(`scorer failed after ${MAX_ATTEMPTS} attempts: ${message}`, attempts, lastErr);
}
