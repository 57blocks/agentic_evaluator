/**
 * LLM-as-judge — pairwise comparison with order-swap de-biasing, scored per
 * rubric dimension.
 *
 * The judge sees two anonymised outputs (A / B) plus the full rubric and the
 * list of dimension keys, and picks the better one FOR EACH DIMENSION plus an
 * overall. We call it twice with the order swapped; per axis, only a consistent
 * verdict across both rounds counts as a win, otherwise it's a tie.
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
import type { DimensionVerdict, Judgement, Winner } from "./types.js";

export const PAIRWISE_EVALUATOR_ID = "pairwise-swap";

/** A judgement plus what it cost to obtain (both rounds, all attempts). */
export type JudgedPair = Judgement & { usage: EvaluatorUsage };

/** Hash of the judge prompt template with the rubric — part of the evaluator version. */
export function judgePromptTemplateSha(rubric: string, dimensions: readonly string[]): string {
  return sha256(buildPrompt(rubric, dimensions, "{{A}}", "{{B}}"));
}

/** Raw winner in the judge's own A/B space (one round, before de-biasing). */
type RawWinner = "A" | "B" | "tie";

interface RawAxis {
  winner: RawWinner;
  reason: string;
}

/** One judge round: a verdict per requested dimension + an overall. */
interface RoundVerdict {
  dimensions: Record<string, RawAxis>;
  overall: RawAxis;
}

function buildPrompt(
  rubric: string,
  dimensions: readonly string[],
  first: string,
  second: string,
): string {
  const dimList =
    dimensions.length > 0
      ? dimensions.map((d) => `- "${d}"`).join("\n")
      : "(no named dimensions — score the overall only)";
  const dimSchema =
    dimensions.length > 0
      ? dimensions
          .map((d) => `"${d}": {"winner": "A" | "B" | "tie", "reason": "<cited evidence>"}`)
          .join(", ")
      : "";
  return [
    "You are a strict, impartial judge comparing two outputs for the same task.",
    "",
    "## Rubric",
    rubric.trim(),
    "",
    "## Dimensions to score",
    "Judge EACH of these dimension keys independently, then give an overall:",
    dimList,
    "",
    "## Output A",
    first.trim(),
    "",
    "## Output B",
    second.trim(),
    "",
    "## Instructions",
    "For every dimension key above, decide which output is better on THAT",
    'dimension alone (A / B / tie). Then give an "overall" verdict. Be decisive;',
    'only use "tie" when genuinely indistinguishable on that axis.',
    "",
    "Every reason must be CHECKABLE by someone holding both outputs: name the",
    "concrete thing you compared — a task id, requirement id, function, type,",
    "file or section — and say what each output did with it. Two to four",
    "sentences. A reason that only asserts a quality (\"better structured\",",
    "\"more thorough\") without naming what in the output makes it so is invalid;",
    "so is a reason that cites something not present in the output it describes.",
    "",
    "Respond with ONLY a JSON object of exactly this shape:",
    `{"dimensions": {${dimSchema}}, "overall": {"winner": "A" | "B" | "tie", "reason": "<cited evidence>"}}`,
  ].join("\n");
}

function asRawWinner(value: unknown): RawWinner {
  return value === "A" || value === "B" || value === "tie" ? value : "tie";
}

/** Narrow one `{winner, reason}` axis; missing/invalid winner → tie. */
function parseAxis(value: unknown): RawAxis {
  if (typeof value !== "object" || value === null) {
    return { winner: "tie", reason: "" };
  }
  const rec = value as Record<string, unknown>;
  const reason = typeof rec.reason === "string" ? rec.reason : "";
  return { winner: asRawWinner(rec.winner), reason };
}

/**
 * Parse the judge JSON. Throws only when NO JSON object can be extracted/parsed
 * (kept identical to the old fail-hard behavior so `judgeAll`'s per-pair
 * try/catch skips the pair). A parseable object with a missing dimension is
 * tolerated — that dimension defaults to tie — so one absent axis never kills
 * the whole comparison.
 */
function parseRound(text: string, dimensions: readonly string[]): RoundVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`judge returned no JSON: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(match[0]) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("judge JSON is not an object");
  }
  const root = parsed as Record<string, unknown>;
  const rawDims =
    typeof root.dimensions === "object" && root.dimensions !== null
      ? (root.dimensions as Record<string, unknown>)
      : {};

  const dims: Record<string, RawAxis> = {};
  for (const key of dimensions) {
    dims[key] = parseAxis(rawDims[key]); // missing → tie
  }
  return { dimensions: dims, overall: parseAxis(root.overall) };
}

/** Max judge attempts per round. temp=0 would re-emit the same bad JSON, so
 *  retries bump the temperature to get a different (hopefully valid) reply. */
const JUDGE_MAX_ATTEMPTS = 3;

/**
 * One judge round with retries. Returns the verdict plus every attempt's usage;
 * throws `EvaluatorCallError` (carrying the attempts) when all attempts fail so
 * the caller can still charge the cost and record an evaluator_error.
 */
async function judgeOnce(
  judgeModel: string,
  rubric: string,
  dimensions: readonly string[],
  first: string,
  second: string,
  timeoutMs?: number,
  trace?: LlmTrace,
  context?: Record<string, unknown>,
): Promise<{ verdict: RoundVerdict; attempts: AttemptUsage[] }> {
  const prompt = buildPrompt(rubric, dimensions, first, second);
  const attempts: AttemptUsage[] = [];
  let lastErr: unknown;
  for (let attempt = 0; attempt < JUDGE_MAX_ATTEMPTS; attempt++) {
    try {
      const r = await complete({
        model: judgeModel,
        prompt,
        temperature: attempt === 0 ? 0 : 0.4,
        timeoutMs,
        // json_object forces well-formed JSON; a generous cap avoids the
        // per-dimension reply being truncated mid-object.
        jsonMode: true,
        maxTokens: 8000,
        trace,
        traceContext: { ...context, attempt },
      });
      try {
        const verdict = parseRound(r.text, dimensions);
        attempts.push(attemptFrom(r, r.ms, true));
        return { verdict, attempts };
      } catch (parseErr) {
        // The call was billed but its output was unusable — a retry, not final.
        attempts.push(attemptFrom(r, r.ms, false));
        lastErr = parseErr;
      }
    } catch (err) {
      if (err instanceof LlmError) attempts.push(attemptFrom(err.usage, err.ms, false));
      lastErr = err;
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new EvaluatorCallError(`judge failed after ${JUDGE_MAX_ATTEMPTS} attempts: ${message}`, attempts, lastErr);
}

/**
 * Map a raw round winner into candidate (a/b) space.
 * - forward round: A=a, B=b (no flip).
 * - reverse round: A=b, B=a (flip).
 */
function toAbSpace(winner: RawWinner, reversed: boolean): Winner {
  if (winner === "tie") return "tie";
  if (!reversed) return winner === "A" ? "a" : "b";
  return winner === "A" ? "b" : "a";
}

/** De-bias one axis: resolve only when both order-swapped rounds agree. */
function resolveAxis(fwd: RawAxis, rev: RawAxis): DimensionVerdict {
  const forward = toAbSpace(fwd.winner, false);
  const reverse = toAbSpace(rev.winner, true);
  return {
    forward,
    reverse,
    resolved: forward === reverse ? forward : "tie",
    // Keep the forward round's reason as the human-facing rationale.
    reason: fwd.reason,
  };
}

/**
 * Compare candidate `a` (output `aText`) vs `b` (output `bText`).
 * Runs forward (a=A, b=B) and reverse (b=A, a=B); resolves each dimension AND
 * the overall independently, counting a win only when both rounds agree.
 */
export async function judgePair(params: {
  judgeModel: string;
  rubric: string;
  /** Rubric dimension keys to score. May be empty (overall only). */
  dimensions: readonly string[];
  inputSlug: string;
  a: string;
  aText: string;
  b: string;
  bText: string;
  /** Per-call timeout for the judge. Large-doc comparisons (PRD/TRD) exceed the
   *  120s llm.ts default, which otherwise aborts mid-judging and fails the suite. */
  timeoutMs?: number;
  trace?: LlmTrace;
  traceContext?: Record<string, unknown>;
}): Promise<JudgedPair> {
  const ctx = { ...params.traceContext, phase: "judge", pair: `${params.a} vs ${params.b}`, input: params.inputSlug };
  const fwd = await judgeOnce(
    params.judgeModel,
    params.rubric,
    params.dimensions,
    params.aText,
    params.bText,
    params.timeoutMs,
    params.trace,
    { ...ctx, round: "forward" },
  );
  let rev: { verdict: RoundVerdict; attempts: AttemptUsage[] };
  try {
    rev = await judgeOnce(
      params.judgeModel,
      params.rubric,
      params.dimensions,
      params.bText,
      params.aText,
      params.timeoutMs,
      params.trace,
      { ...ctx, round: "reverse" },
    );
  } catch (err) {
    // The forward round was paid for; surface its attempts with the failure.
    if (err instanceof EvaluatorCallError) {
      throw new EvaluatorCallError(err.message, [...fwd.attempts, ...err.attempts], err.cause);
    }
    throw err;
  }

  const dimensions: Record<string, DimensionVerdict> = {};
  for (const key of params.dimensions) {
    dimensions[key] = resolveAxis(fwd.verdict.dimensions[key], rev.verdict.dimensions[key]);
  }

  return {
    inputSlug: params.inputSlug,
    a: params.a,
    b: params.b,
    dimensions,
    overall: resolveAxis(fwd.verdict.overall, rev.verdict.overall),
    usage: summarizeAttempts([...fwd.attempts, ...rev.attempts]),
  };
}
