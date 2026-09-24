/**
 * What an evaluation tests, in words a reader can check against the spec.
 *
 * A spec.yaml is the whole contract — which task, which candidates, how a
 * trial is judged right or wrong, which gates a candidate must pass, how the
 * survivors are ranked, what it may spend — but as YAML it takes a person
 * who already knows the schema to read it. This turns it into one view the
 * dashboard can show.
 *
 * Two sources, one shape:
 *   - `planFromSuites` reads the compiled spec: what a task WILL test.
 *   - `planFromRun` reads a run's frozen manifest: what it DID test, which
 *     may differ from the spec on disk today.
 */

import type { Suite } from "./types.js";
import type { CandidateDef, EligibilityThresholds } from "./canon/types.js";
import type { RunBundle } from "./report-v2.js";
import { resolveEligibility } from "./canon/select.js";
import { planStep, methodsOf, planE2e } from "./core/plan.js";
import { readInput } from "./core/generate.js";
import { gateLabels, modeExplain, modeLabel } from "./report-copy.js";

export interface PlanCandidate {
  id: string;
  /** Model id, or the command an agent candidate runs. */
  model: string;
  /** How the candidate is called, said in words. */
  via: string;
  isControl: boolean;
}

export interface PlanInput {
  id: string;
  /** The input's first line — usually the task statement. Null when the text is not at hand. */
  title: string | null;
}

export interface PlanStep {
  id: string;
  /** What a candidate is asked to produce. Null when the source does not say. */
  task: string | null;
  inputFrom: string | null;
  inputs: PlanInput[];
  candidates: PlanCandidate[];
  trials: number;
  /** How a trial is judged right or wrong. Empty means it cannot be. */
  checks: Array<{ id: string; how: string }>;
  gates: string[];
  mode: { id: string | null; label: string; explain: string };
  /** Declared minimum meaningful difference; null when the spec leaves it out. */
  mmd: number | null;
  judge: { model: string; methods: string[]; dimensions: string[] } | null;
  scale: { generations: number; judgeCalls: number; scoreCalls: number };
}

export interface TestPlan {
  steps: PlanStep[];
  budgetUsd: number | null;
  /** The chained steps, when a later step takes an earlier one's output. */
  chain: string[] | null;
}

// ── words ────────────────────────────────────────────────────────────────────

const PRODUCER: Record<string, string> = {
  prompt: "the model answers the task in the input directly",
  codegen: "the model writes code files from the input",
  agent: "a command-line agent does the task in its own work dir",
};

const METHOD: Record<string, string> = {
  "pairwise-swap": "pairwise (judged once in each order)",
  "absolute-1-5": "each output scored 1–5",
};

/** How a candidate is called. */
export function candidateVia(def: CandidateDef | undefined): string {
  if (!def) return "—";
  if (def.adapter === "agent-cli" || def.cli) {
    return def.cli?.image ? `command-line agent, isolated in docker (${def.cli.image})` : "command-line agent, run directly on this machine";
  }
  const route = def.provider_route ? `called via ${def.provider_route}` : "calls the model API";
  const temp = def.generation_settings?.temperature;
  return temp === undefined ? route : `${route}, temperature ${temp}`;
}

function candidateModel(def: CandidateDef | undefined, id: string): string {
  if (!def) return id;
  return def.model ?? (def.cli ? def.cli.argv.join(" ") : id);
}

/**
 * The first line of an input that says something — where a task statement
 * usually sits. Comments and markup around it (an HTML comment marking a
 * frozen fixture, a heading's `#`) are not the statement.
 */
export function inputTitle(text: string): string {
  const prose = text.replace(/<!--[\s\S]*?-->/g, "");
  const line = prose.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l !== "") ?? "";
  return line.length > 90 ? `${line.slice(0, 88)}…` : line;
}

function checkHow(suite: Suite): Array<{ id: string; how: string }> {
  const c = suite.check;
  if (!c) return (suite.requiredChecks ?? []).map((id) => ({ id, how: "—" }));
  if (c.kind === "tsc") return [{ id: c.id, how: `compile the candidate's files with tsc --noEmit (config from ${c.scaffoldDir}/)` }];
  return [{ id: c.id, how: `run ${c.argv.join(" ")} in the trial dir, ${Math.round(c.timeoutMs / 1000)} s timeout` }];
}

// ── from the spec ────────────────────────────────────────────────────────────

async function stepFromSuite(suite: Suite): Promise<PlanStep> {
  const defs = suite.candidateDefs ?? {};
  const required = suite.requiredChecks ?? [];
  const eligibility: EligibilityThresholds = resolveEligibility(required, suite.eligibility);
  const methods = methodsOf(suite);
  const scale = planStep(suite);
  const inputs = await Promise.all(
    suite.inputs.map(async (id) => ({
      id,
      title: await readInput(id, suite.taskRoot).then(inputTitle, () => null),
    })),
  );
  return {
    id: suite.step,
    task: PRODUCER[suite.producer ?? "prompt"] ?? null,
    inputFrom: suite.inputFrom ?? null,
    inputs,
    candidates: suite.candidates.map((id) => ({
      id,
      model: candidateModel(defs[id], id),
      via: candidateVia(defs[id]),
      isControl: suite.controlCandidate === id,
    })),
    trials: scale.trials,
    checks: checkHow(suite),
    gates: gateLabels(eligibility, required, suite.operatingMode),
    mode: { id: suite.operatingMode ?? null, label: modeLabel(suite.operatingMode), explain: modeExplain(suite.operatingMode) },
    mmd: suite.mmd ?? null,
    judge:
      methods.pairwise || methods.absolute
        ? {
            model: suite.judge,
            methods: [methods.pairwise && METHOD["pairwise-swap"], methods.absolute && METHOD["absolute-1-5"]].filter(
              (m): m is string => Boolean(m),
            ),
            dimensions: [...(suite.dimensions ?? [])],
          }
        : null,
    scale: { generations: scale.generations, judgeCalls: scale.judgeCalls, scoreCalls: scale.scoreCalls },
  };
}

export async function planFromSuites(suites: readonly Suite[]): Promise<TestPlan> {
  return {
    steps: await Promise.all(suites.map(stepFromSuite)),
    budgetUsd: suites[0]?.budgetUsd ?? null,
    chain: planE2e(suites)?.chain ?? null,
  };
}

// ── from a run ───────────────────────────────────────────────────────────────

/**
 * What one run actually tested, from its frozen manifest. Input text is not
 * in the run directory — only its hash — so titles are left out rather than
 * read from a spec that may have changed since.
 */
export function planFromRun(b: RunBundle): PlanStep {
  const m = b.manifest;
  const rec = b.recommendation;
  const evaluators = new Set(b.summary.evaluation_coverage.map((c) => c.evaluator));
  const methods = ["pairwise-swap", "absolute-1-5"].filter((e) => evaluators.has(e)).map((e) => METHOD[e]);
  const dims = [...new Set(b.evaluations.flatMap((e) => Object.keys(e.dimensions ?? {})))];
  const candidates = Object.keys(m.candidates);
  const inputs = Object.keys(m.test_set.inputs ?? {});
  const trials = m.execution.trials_per_case;
  return {
    id: m.step.id,
    task: null,
    inputFrom: null,
    inputs: inputs.map((id) => ({ id, title: null })),
    candidates: candidates.map((id) => ({
      id,
      model: candidateModel(m.candidates[id], id),
      via: candidateVia(m.candidates[id]),
      isControl: m.control_candidate === id,
    })),
    trials,
    checks: m.evaluators.required_checks.map((id) => ({
      id,
      how: m.evaluators.check_version ? `version ${m.evaluators.check_version}` : "—",
    })),
    gates: gateLabels(rec.eligibility, m.evaluators.required_checks, m.operating_mode),
    mode: { id: m.operating_mode ?? null, label: modeLabel(m.operating_mode), explain: modeExplain(m.operating_mode) },
    mmd: m.minimum_meaningful_difference ?? null,
    judge: methods.length > 0 ? { model: m.judge.model, methods, dimensions: dims } : null,
    scale: {
      generations: b.trials.length,
      judgeCalls: b.evaluations.filter((e) => e.subject.kind === "pair").length * 2,
      scoreCalls: b.evaluations.filter((e) => e.evaluator === "absolute-1-5").length,
    },
  };
}
