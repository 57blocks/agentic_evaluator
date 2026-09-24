/**
 * Run a chained workflow end to end for one arm (protocol §8 step 3).
 *
 * An arm is an assignment of one candidate per step: the single-model control
 * assigns the same candidate everywhere, the proposed combination assigns each
 * step its chosen candidate. No pairwise judge — this is the validation pass,
 * not another leaderboard.
 */

import type { ArtifactFile } from "./adapters/types.js";
import {
  armRates,
  decideE2eOutcome,
  type ArmRates,
  type E2eCase,
  type E2eStepResult,
  type StepAssignment,
} from "./canon/e2e.js";
import { sha256 } from "./canon/hash.js";
import { decideTaskOutcome } from "./canon/success.js";
import type { CompletionState, EvaluationResult } from "./canon/types.js";
import type { Suite } from "./types.js";

export type { E2eCase, E2eStepResult };

export interface E2eTotals {
  cases: number;
  success: number;
  failure: number;
  undetermined: number;
  cost_usd: number;
  ms: number;
}

export interface E2eArmReport {
  protocol_version: "0.3";
  arm_id: string;
  arm_kind: "proposed" | "control";
  assignment: StepAssignment;
  chain: string[];
  cases: E2eCase[];
  totals: E2eTotals;
  rates: ArmRates;
}

/** The control arm, keeping the published `e2e-control.json` shape. */
export interface E2eControlReport extends E2eArmReport {
  arm_kind: "control";
  kind: "single-model-e2e-control";
  candidate: string;
}

export interface E2eGeneration {
  completion_state: CompletionState;
  text: string;
  artifacts: ArtifactFile[];
  cost_usd: number;
  ms: number;
  checks: EvaluationResult[];
}

/** One step of one arm: the candidate is whatever the arm assigned to that step. */
export type E2eArmGenerate = (
  step: Suite,
  candidate: string,
  inputSlug: string,
  inputText: string,
  trial: number,
) => Promise<E2eGeneration>;

export type E2eGenerate = (
  step: Suite,
  inputSlug: string,
  inputText: string,
  trial: number,
) => Promise<E2eGeneration>;

/** Prefer artifacts (codegen / CLI) so the next step sees files, not stdout. */
export function handoffPayload(gen: Pick<E2eGeneration, "text" | "artifacts">): string {
  if (gen.artifacts.length === 0) return gen.text;
  return gen.artifacts.map((f) => "```file:" + f.path + "\n" + f.content + "\n```").join("\n\n");
}

export function constantAssignment(chain: readonly Suite[], candidate: string): StepAssignment {
  return Object.fromEntries(chain.map((s) => [s.step, candidate]));
}

function totalsOf(cases: readonly E2eCase[]): E2eTotals {
  const totals: E2eTotals = {
    cases: cases.length,
    success: 0,
    failure: 0,
    undetermined: 0,
    cost_usd: 0,
    ms: 0,
  };
  for (const c of cases) {
    if (c.outcome === "success") totals.success += 1;
    else if (c.outcome === "failure") totals.failure += 1;
    else totals.undetermined += 1;
    for (const s of c.steps) {
      totals.cost_usd += s.cost_usd;
      totals.ms += s.ms;
    }
  }
  return totals;
}

export async function runChainArm(params: {
  armId: string;
  armKind: "proposed" | "control";
  assignment: StepAssignment;
  chain: Suite[];
  rootInputs: Array<{ slug: string; text: string }>;
  trials: number;
  generate: E2eArmGenerate;
}): Promise<E2eArmReport> {
  const { armId, armKind, assignment, chain, rootInputs, trials, generate } = params;
  const missing = chain.filter((s) => !assignment[s.step]).map((s) => s.step);
  if (missing.length > 0) {
    throw new Error(`arm "${armId}" has no candidate for step(s): ${missing.join(", ")}`);
  }

  const cases: E2eCase[] = [];
  for (const root of rootInputs) {
    for (let trial = 0; trial < trials; trial++) {
      const steps: E2eStepResult[] = [];
      let nextText = root.text;
      let aborted = false;
      for (const step of chain) {
        const candidate = assignment[step.step];
        const inputSha = sha256(nextText);
        const gen = await generate(step, candidate, root.slug, nextText, trial);
        const decided = decideTaskOutcome({
          criteria: step.successCriteria,
          requiredChecks: step.requiredChecks ?? [],
          completion: gen.completion_state,
          checks: gen.checks,
        });
        const payload = handoffPayload(gen);
        steps.push({
          id: step.step,
          candidate,
          completion_state: gen.completion_state,
          task_outcome: decided.outcome,
          outcome_reasons: decided.reasons,
          cost_usd: gen.cost_usd,
          ms: gen.ms,
          input_sha: inputSha,
          output_sha: sha256(payload),
          checks: gen.checks,
        });
        if (decided.outcome === "failure") {
          aborted = true;
          break;
        }
        nextText = payload;
      }
      cases.push({
        input: root.slug,
        trial,
        steps,
        outcome: decideE2eOutcome(steps.map((s) => s.task_outcome)),
        aborted,
      });
    }
  }

  return {
    protocol_version: "0.3",
    arm_id: armId,
    arm_kind: armKind,
    assignment,
    chain: chain.map((s) => s.step),
    cases,
    totals: totalsOf(cases),
    rates: armRates(cases),
  };
}

/** The single-model control arm: one candidate for every step in the chain. */
export async function runControlChain(params: {
  candidate: string;
  chain: Suite[];
  rootInputs: Array<{ slug: string; text: string }>;
  trials: number;
  generate: E2eGenerate;
}): Promise<E2eControlReport> {
  const { candidate, generate, ...rest } = params;
  const arm = await runChainArm({
    ...rest,
    armId: "control",
    armKind: "control",
    assignment: constantAssignment(params.chain, candidate),
    generate: (step, _candidate, slug, text, trial) => generate(step, slug, text, trial),
  });
  return { ...arm, arm_kind: "control", kind: "single-model-e2e-control", candidate };
}
