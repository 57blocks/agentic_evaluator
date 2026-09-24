/**
 * The end-to-end arms (protocol §8, step 3).
 *
 * One arm = one candidate per step, run over the same (input, trial) cases.
 * The control arm runs the declared `control_candidate` across the whole
 * chain; the proposed arm runs whatever each step's recommendation chose.
 * Only an improvement of at least the declared minimum meaningful difference
 * adopts the combination — and when the two assignments are identical the
 * second arm is not run at all, because paying twice for the same answer
 * would not make it more true.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  decideValidation,
  pairCases,
  proposedAssignment,
  sameAssignment,
  type E2eValidation,
  type StepAssignment,
  type ValidationArm,
  type ValidationThresholds,
} from "../canon/e2e.js";
import {
  constantAssignment,
  runChainArm,
  type E2eArmGenerate,
  type E2eArmReport,
  type E2eControlReport,
} from "../e2e-control.js";
import { TSC_CHECK_ID } from "../check.js";
import { openTrace } from "../canon/trace.js";
import { classifyCompletion } from "../canon/states.js";
import { defOf, errorRecord, generateOne, readInput, safeName } from "./generate.js";
import { loadPromptTemplate } from "./execute.js";
import { e2eChain } from "./plan.js";
import { taskRootOf } from "../paths.js";
import type { RunEventSink } from "./events.js";
import { resolveEligibility } from "../canon/select.js";
import type { EligibilityThresholds } from "../canon/types.js";
import type { Suite } from "../types.js";

export interface E2eArms {
  control: E2eControlReport | null;
  proposed: E2eArmReport | null;
  validation: E2eValidation | null;
}

/** The workflow must clear the strictest gate any chained step declares. */
export function workflowThresholds(chain: readonly Suite[]): ValidationThresholds {
  const declared = chain.map((s) => resolveEligibility(s.requiredChecks ?? [], s.eligibility));
  const strictest = (pick: (t: EligibilityThresholds) => number | null): number | null => {
    const values = declared.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : Math.max(...values);
  };
  return {
    minimum_reliability: strictest((t) => t.minimum_reliability),
    minimum_required_check_pass_rate: strictest((t) => t.minimum_required_check_pass_rate),
  };
}

/** One comparison needs one mode; disagreeing steps leave the workflow unvalidated. */
export function workflowMode(chain: readonly Suite[]): { mode: string } | { reason: string } {
  const modes = [...new Set(chain.map((s) => s.operatingMode ?? "(none)"))];
  if (modes.length > 1) {
    return { reason: `chained steps declare different operating modes (${modes.join(", ")})` };
  }
  if (modes[0] === "(none)") {
    return { reason: "no operating_mode declared on the chained steps" };
  }
  return { mode: modes[0] };
}

/** Generation for one arm: its own check work dirs and its own trace file. */
async function openArmRunner(params: {
  armId: string;
  chain: Suite[];
  root: string;
  runId: string;
  emit: RunEventSink;
}): Promise<{ outDir: string; generate: E2eArmGenerate; close: () => Promise<unknown> }> {
  const { armId, chain, root, runId, emit } = params;
  const outDir = path.join(root, armId);
  await fs.mkdir(outDir, { recursive: true });
  const trace = await openTrace(outDir, `${runId}/${armId}`);
  const promptByStep = new Map<string, string>();
  for (const step of chain) {
    promptByStep.set(step.step, (await loadPromptTemplate(step, step.producer ?? "prompt")).promptTpl);
  }

  const generate: E2eArmGenerate = async function (step, candidate, inputSlug, inputText, trial) {
    const def = defOf(step, candidate);
    const checkWorkDir = path.join(outDir, "checks", `${safeName(step.step)}__${inputSlug}__t${trial}`);
    try {
      const g = await generateOne({
        suite: step,
        producer: step.producer ?? "prompt",
        promptTpl: promptByStep.get(step.step) ?? "",
        inputSlug,
        inputText,
        def,
        temperature: def.generation_settings?.temperature ?? step.temperature ?? 0.3,
        timeoutMs: step.timeoutMs ?? 120_000,
        checkWorkDir,
        trace: trace.emit,
        traceContext: { phase: armId, candidate, step: step.step, input: inputSlug, trial },
      });
      const verdict = classifyCompletion({
        finishReason: g.finishReason,
        refusal: g.refusal,
        parsedUnits: g.parsedUnits,
      });
      const checks =
        g.checkState === undefined
          ? []
          : [{ evaluator: step.check?.id ?? TSC_CHECK_ID, version: g.checkVersion ?? "unknown", state: g.checkState }];
      emit({ type: "trial", step: step.step, candidate, input: inputSlug, trial, state: verdict.state, ms: g.ms, costUsd: g.costUsd });
      return {
        completion_state: verdict.state,
        text: g.text,
        artifacts: g.artifacts,
        cost_usd: g.costUsd,
        ms: g.ms,
        checks,
      };
    } catch (err) {
      const rec = errorRecord({ inputSlug, inputText, candidate, def, trial, hash: "" }, err);
      emit({ type: "trial", step: step.step, candidate, input: inputSlug, trial, state: rec.completionState ?? "error", error: rec.error });
      return {
        completion_state: rec.completionState ?? "malformed",
        text: "",
        artifacts: [],
        cost_usd: rec.costUsd,
        ms: rec.ms,
        checks: [],
      };
    }
  };

  return { outDir, generate, close: trace.close };
}

function validationArm(
  report: E2eArmReport,
  kind: "proposed" | "control",
): ValidationArm {
  return {
    arm_id: report.arm_id,
    kind,
    assignment: report.assignment,
    cases: report.cases.length,
    rates: report.rates,
  };
}

/**
 * Protocol §8 step 3: run the single-model control and, when the step-level
 * recommendations propose a different combination, run that combination over
 * the same cases and decide whether it may be adopted.
 */
export async function maybeRunE2eValidation(params: {
  emit: RunEventSink;
  suites: Suite[];
  root: string;
  runId: string;
  chosenByStep: Record<string, string | null>;
}): Promise<E2eArms | null> {
  const { suites, root, runId, chosenByStep, emit } = params;
  const chain = e2eChain(suites);
  if (!chain) return null;
  const controlCandidate = chain[0].controlCandidate;
  if (!controlCandidate) return null;

  const rootInputs = await Promise.all(
    chain[0].inputs.map(async (slug) => ({ slug, text: await readInput(slug, taskRootOf(chain[0])) })),
  );
  const trials = chain[0].trials ?? 2;

  const runArm = async (
    armId: string,
    armKind: "proposed" | "control",
    assignment: StepAssignment,
  ): Promise<E2eArmReport> => {
    const runner = await openArmRunner({ armId, chain, root, runId, emit });
    emit({ type: "e2e.arm.start", armId, assignment: { ...assignment } });
    try {
      return await runChainArm({
        armId,
        armKind,
        assignment,
        chain,
        rootInputs,
        trials,
        generate: runner.generate,
      });
    } finally {
      await runner.close();
    }
  };

  const controlAssignment = constantAssignment(chain, controlCandidate);
  const controlArm = await runArm("e2e-control", "control", controlAssignment);
  const control: E2eControlReport = {
    ...controlArm,
    arm_kind: "control",
    kind: "single-model-e2e-control",
    candidate: controlCandidate,
  };
  const controlJson = JSON.stringify(control, null, 2);
  await fs.writeFile(path.join(root, "e2e-control", "e2e-control.json"), controlJson, "utf-8");
  await fs.writeFile(path.join(root, "e2e-control.json"), controlJson, "utf-8");
  emit({
    type: "e2e.arm.done",
    armId: "e2e-control",
    candidate: controlCandidate,
    success: control.totals.success,
    failure: control.totals.failure,
    undetermined: control.totals.undetermined,
  });

  const chainIds = chain.map((s) => s.step);
  const proposal = proposedAssignment(chainIds, chosenByStep);
  const mode = workflowMode(chain);
  const thresholds = workflowThresholds(chain);
  const shared = {
    mmd: chain[0].mmd ?? null,
    thresholds,
    inputs: rootInputs.length,
    control: validationArm(control, "control"),
  };

  let proposed: E2eArmReport | null = null;
  let validation: E2eValidation;
  if ("reason" in proposal) {
    validation = decideValidation({ ...shared, mode: null, proposed: null, notValidatedReason: proposal.reason });
  } else if ("reason" in mode) {
    validation = decideValidation({ ...shared, mode: null, proposed: null, notValidatedReason: mode.reason });
  } else if (sameAssignment(proposal.assignment, controlAssignment)) {
    validation = decideValidation({
      ...shared,
      mode: mode.mode,
      proposed: null,
      blockedReason: `the proposed combination is the single-model control (${controlCandidate}); no second arm was run`,
    });
  } else {
    proposed = await runArm("e2e-proposed", "proposed", proposal.assignment);
    await fs.writeFile(
      path.join(root, "e2e-proposed", "e2e-proposed.json"),
      JSON.stringify(proposed, null, 2),
      "utf-8",
    );
    emit({
      type: "e2e.arm.done",
      armId: "e2e-proposed",
      success: proposed.totals.success,
      failure: proposed.totals.failure,
      undetermined: proposed.totals.undetermined,
    });
    validation = decideValidation({
      ...shared,
      mode: mode.mode,
      proposed: validationArm(proposed, "proposed"),
      pairs: pairCases(proposed.cases, control.cases),
    });
  }

  await fs.writeFile(
    path.join(root, "e2e-validation.json"),
    JSON.stringify(validation, null, 2),
    "utf-8",
  );
  emit({ type: "e2e.validated", verdict: validation.verdict, firmness: validation.firmness, reason: validation.reasons[0] ?? "" });
  return { control, proposed, validation };
}

/**
 * Run a spec (one or more independent steps) or a legacy JSON suite.
 * Single-step output layout is unchanged. Multi-step writes each step under
 * runs/<runId>/<stepId>/ plus workflow.json at the root (no handoff).
 * When steps declare input_from, the end-to-end validation pass runs after the
 * independent eval: the single-model control arm, the proposed combination arm
 * when the step recommendations differ from it, and the verdict that decides
 * whether the combination may be adopted (e2e-validation.json).
 */
