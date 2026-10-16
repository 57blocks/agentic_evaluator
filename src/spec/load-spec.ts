/**
 * Spec loader — protocol-style YAML in, the harness's `Suite` out.
 *
 * The YAML is the user-facing, versioned source of truth (protocol §4). It is
 * validated against `SPEC_SCHEMA`, then compiled into the internal `Suite` so
 * `run.ts` keeps its control flow.
 *
 * Specs may declare several independent steps; each compiles to its own Suite.
 * Independent eval does not pipe output forward. Steps with `input_from` form
 * the single-model e2e control chain (protocol §8).
 */

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { adapterIdOf } from "../adapters/types.js";
import { orderControlChain } from "../canon/e2e.js";
import { sha256 } from "../canon/hash.js";
import type { CandidateDef, EligibilityDecl } from "../canon/types.js";
import type { CheckConfig, JudgeMethod } from "../types.js";
import { workspaceForSpec, type Workspace } from "../core/workspace.js";
import type { Suite } from "../types.js";
import { SPEC_SCHEMA } from "./schema.js";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface EvalStep {
  id: string;
  version: string;
  test_set: { id: string; inputs: string[]; fixture_dir?: string; labels_file?: string };
  candidate_ids: string[];
  required_checks?: string[];
  judged_dimensions?: string[];
  success_criteria?: { mandatory_checks: "all" };
  operating_mode?: string;
  eligibility?: EligibilityDecl;
  maximum_completion_time_seconds?: number;
  /** A spend cap per trial, handed to command candidates (they enforce it). */
  max_cost_per_trial_usd?: number;
  /** Trials in flight for this step; execution.concurrency otherwise. */
  concurrency?: number;
  /** Whether a command's non-zero exit fails its trials on this step (over cli.exit_code). */
  exit_code?: "fail" | "ignore";
  /** This step's judging, over evaluators.judge (whose model it keeps). */
  judge?: StepJudge;
  /** Overrides x-harness.producer for this step. */
  producer?: "prompt" | "codegen";
  prompt_file?: string;
  rubric_file?: string;
  /** Prior step id whose output is this step's input during e2e control. Independent eval still uses test_set. */
  input_from?: string;
  /** What a chained step starts from: the previous output as text (default), or its files. */
  handoff?: "text" | "workdir";
}

/** Judging for one step (or the e2e arms): any field left out comes from evaluators.judge. */
export interface StepJudge {
  rubric_file?: string;
  methods?: string[];
  show?: string[];
  dimensions?: string[];
}

/** Static shape of a validated spec (mirrors SPEC_SCHEMA; kept loose on purpose). */
export interface EvalSpec {
  protocol_version: string;
  run_name: string;
  description?: string;
  budget_usd?: number;
  workflow: {
    control_candidate?: string;
    /** End-to-end validation: which root inputs the chain runs on, and what grades its end product. */
    e2e?: {
      inputs?: string[];
      final_checks?: string[];
      steps?: Record<string, { max_cost_per_trial_usd?: number; maximum_completion_time_seconds?: number }>;
      judge?: { rubric_file: string; show?: string[]; dimensions?: string[] };
    };
    steps: EvalStep[];
  };
  candidates: CandidateDef[];
  evaluators: {
    required_checks?: Record<
      string,
      {
        kind: "tsc" | "command";
        scaffold_dir?: string;
        argv?: string[];
        version_files?: string[];
        timeout_seconds?: number;
        description?: string;
      }
    >;
    judge: { model: string; provider_route?: string; rubric_file: string; methods?: string[]; show?: string[] };
    human?: { rubric_file: string; method?: "pairwise"; show?: string[]; dimensions?: string[] };
  };
  execution: {
    trials_per_case: number;
    concurrency?: number;
    benchmark_mode?: "capability-neutral" | "production-realistic";
    cache_mode?: "cold" | "warm" | "both";
    minimum_meaningful_difference?: number | null;
  };
  "x-harness"?: {
    producer: "prompt" | "codegen";
    prompt_file?: string;
    default_temperature?: number;
    allow_same_vendor_judge?: boolean;
  };
}

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Draft-07 documents validate fine under the 2020 validator once the $schema
// keyword is dropped; we pass the schema body only.
const { $schema: _dropped, ...schemaBody } = SPEC_SCHEMA as unknown as Record<string, unknown>;
const validateSpec = ajv.compile(schemaBody);

/** Vendor prefix of an OpenRouter model id ("anthropic/claude-x" → "anthropic"). */
function vendorOf(modelId: string): string {
  return modelId.split("/")[0] ?? modelId;
}

export function parseSpec(text: string, specPath: string): EvalSpec {
  // `merge`: `<<: *anchor` folds shared blocks (one candidate's cli, a
  // provider's env) into many, so a spec states them once.
  const data: unknown = parseYaml(text, { merge: true });
  if (!validateSpec(data)) {
    const issues = (validateSpec.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
      .join("; ");
    throw new SpecError(`spec ${specPath} failed schema validation: ${issues}`);
  }
  return data as EvalSpec;
}

function specError(specPath: string, message: string): SpecError {
  return new SpecError(`spec ${specPath}: ${message}`);
}

function duplicateIds(ids: readonly string[]): string[] {
  return ids.filter((id, i, all) => all.indexOf(id) !== i);
}

/** Per-step producer / prompt / rubric win over x-harness and evaluators.judge. */
function stepOverrides(step: EvalStep, spec: EvalSpec): {
  producer: "prompt" | "codegen";
  promptFile: string | undefined;
  rubricFile: string;
} {
  const harness = spec["x-harness"]!;
  return {
    producer: step.producer ?? harness.producer,
    promptFile: step.prompt_file ?? harness.prompt_file,
    rubricFile: step.judge?.rubric_file ?? step.rubric_file ?? spec.evaluators.judge.rubric_file,
  };
}

/** Semantic checks the schema cannot express. */
function checkSemantics(spec: EvalSpec, specPath: string): void {
  const steps = spec.workflow.steps;
  const stepDupes = duplicateIds(steps.map((s) => s.id));
  if (stepDupes.length > 0) throw specError(specPath, `duplicate step ids ${stepDupes.join(", ")}`);

  const byId = new Map(spec.candidates.map((c) => [c.id, c]));
  const dupes = duplicateIds(spec.candidates.map((c) => c.id));
  if (dupes.length > 0) throw specError(specPath, `duplicate candidate ids ${dupes.join(", ")}`);

  if (spec.workflow.control_candidate && !byId.has(spec.workflow.control_candidate)) {
    throw specError(specPath, `control_candidate "${spec.workflow.control_candidate}" is not a declared candidate`);
  }

  const harness = spec["x-harness"];
  if (!harness) throw specError(specPath, "x-harness.producer is required this milestone");

  const declaredChecks = new Set(Object.keys(spec.evaluators.required_checks ?? {}));
  const judgeVendor = vendorOf(spec.evaluators.judge.model);

  for (const step of steps) {
    const missing = step.candidate_ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw specError(specPath, `step "${step.id}" references unknown candidate ids ${missing.join(", ")}`);
    }

    const { producer, promptFile } = stepOverrides(step, spec);
    if (producer === "prompt" && !promptFile) {
      throw specError(specPath, `step "${step.id}" producer "prompt" needs prompt_file`);
    }

    for (const id of step.candidate_ids) {
      const c = byId.get(id)!;
      const adapter = adapterIdOf(c, producer);
      if (adapter === "agent-cli" && !c.cli?.argv?.length) {
        throw specError(specPath, `candidate "${c.id}" adapter agent-cli needs cli.argv`);
      }
      if (adapter !== "agent-cli" && !c.model) {
        throw specError(specPath, `candidate "${c.id}" adapter ${adapter} needs a model`);
      }
    }

    const sameVendor = step.candidate_ids.filter((id) => {
      const model = byId.get(id)!.model;
      return model !== undefined && vendorOf(model) === judgeVendor;
    });
    if (sameVendor.length > 0 && !harness.allow_same_vendor_judge) {
      throw specError(
        specPath,
        `step "${step.id}" judge ${spec.evaluators.judge.model} shares a vendor with candidate(s) ${sameVendor.join(", ")}; ` +
          `the protocol requires a cross-vendor judge (set x-harness.allow_same_vendor_judge to override deliberately)`,
      );
    }

    const undeclared = (step.required_checks ?? []).filter((c) => !declaredChecks.has(c));
    if (undeclared.length > 0) {
      throw specError(specPath, `step "${step.id}" required_checks ${undeclared.join(", ")} have no evaluator definition`);
    }
  }

  checkControlChain(spec, specPath);
}

function checkControlChain(spec: EvalSpec, specPath: string): void {
  const steps = spec.workflow.steps;
  const indexOf = new Map(steps.map((s, i) => [s.id, i]));

  for (const step of steps) {
    if (!step.input_from) continue;
    const parent = indexOf.get(step.input_from);
    if (parent === undefined) {
      throw specError(specPath, `step "${step.id}" input_from "${step.input_from}" is not a declared step`);
    }
    if (parent >= indexOf.get(step.id)!) {
      throw specError(specPath, `step "${step.id}" input_from "${step.input_from}" must be an earlier step`);
    }
  }

  const chain = orderControlChain(steps.map((s) => ({ id: s.id, inputFrom: s.input_from })));
  if (!chain) {
    if (steps.some((s) => s.input_from)) {
      throw specError(specPath, "input_from must form a single linear chain (no forks or cycles)");
    }
    if (spec.workflow.e2e) {
      throw specError(specPath, "workflow.e2e needs a chain: no step declares input_from");
    }
    return;
  }

  const control = spec.workflow.control_candidate;
  if (!control) {
    throw specError(specPath, "input_from requires workflow.control_candidate for the single-model e2e control");
  }
  for (const id of chain) {
    if (!steps[indexOf.get(id)!].candidate_ids.includes(control)) {
      throw specError(specPath, `control_candidate "${control}" is not in step "${id}" candidate_ids`);
    }
  }
  checkE2eBlock(spec, specPath, steps[indexOf.get(chain[0])!]);
}

/** workflow.e2e: its inputs are the chain's first step's, and its final check is declared. */
function checkE2eBlock(spec: EvalSpec, specPath: string, root: EvalStep): void {
  const e2e = spec.workflow.e2e;
  if (!e2e) return;
  const unknown = (e2e.inputs ?? []).filter((i) => !root.test_set.inputs.includes(i));
  if (unknown.length > 0) {
    throw specError(specPath, `workflow.e2e.inputs ${unknown.join(", ")} are not inputs of "${root.id}", where the chain starts`);
  }
  const strangers = Object.keys(e2e.steps ?? {}).filter((id) => !spec.workflow.steps.some((s) => s.id === id && (s.input_from || s.id === root.id)));
  if (strangers.length > 0) {
    throw specError(specPath, `workflow.e2e.steps ${strangers.join(", ")} are not steps of the chain`);
  }
  const undeclared = (e2e.final_checks ?? []).filter((c) => !spec.evaluators.required_checks?.[c]);
  if (undeclared.length > 0) {
    throw specError(specPath, `workflow.e2e.final_checks ${undeclared.join(", ")} have no evaluator definition`);
  }
}

const DEFAULT_CHECK_TIMEOUT_S = 120;
const ALL_JUDGE_METHODS: JudgeMethod[] = ["pairwise-swap", "absolute-1-5"];

/**
 * Declared methods, or both when the spec is silent.
 *
 * An **absent** `methods` key means the spec has no opinion, and both methods
 * run — that is what every spec written before the key existed means. An
 * **empty list** is an opinion: run neither. Collapsing the two (as this did)
 * billed a full judging pass on a step that had asked for none, and left no
 * way to declare a check-only step.
 */
function judgeMethodsOf(spec: EvalSpec, own?: StepJudge): JudgeMethod[] {
  const declared = own?.methods ?? spec.evaluators.judge.methods;
  if (!declared) return [...ALL_JUDGE_METHODS];
  return ALL_JUDGE_METHODS.filter((m) => declared.includes(m));
}

/**
 * The step's required check, resolved against the evaluator definitions.
 *
 * One per step: the trial record carries a single check result, so a second
 * one would be silently dropped. Rejecting it is better than gating on
 * whichever happened to be found first.
 */
function compileCheck(
  spec: EvalSpec,
  specPath: string,
  stepId: string,
  requiredChecks: readonly string[],
): CheckConfig | undefined {
  if (requiredChecks.length === 0) return undefined;
  if (requiredChecks.length > 1) {
    throw specError(
      specPath,
      `step "${stepId}" declares ${requiredChecks.length} required checks (${requiredChecks.join(", ")}); one per step is supported`,
    );
  }
  const id = requiredChecks[0];
  const def = spec.evaluators.required_checks?.[id];
  if (!def) throw specError(specPath, `step "${stepId}" required check "${id}" has no evaluator definition`);
  if (def.kind === "tsc") {
    return { id, kind: "tsc", scaffoldDir: def.scaffold_dir ?? "scaffold" };
  }
  if (!def.argv || def.argv.length === 0) {
    throw specError(specPath, `required check "${id}" is kind: command and must declare argv`);
  }
  return {
    id,
    kind: "command",
    argv: [...def.argv],
    versionFiles: [...(def.version_files ?? [])],
    timeoutMs: (def.timeout_seconds ?? DEFAULT_CHECK_TIMEOUT_S) * 1000,
  };
}

/** workflow.e2e, compiled: the same on every step (the chain reads it off its first and last). */
function e2eOf(spec: EvalSpec, specPath: string, stepId: string): Pick<Suite, "e2eInputs" | "e2eFinalCheck" | "e2eJudge" | "e2eLimits"> {
  const e2e = spec.workflow.e2e;
  if (!e2e) return {};
  const finalCheck = e2e.final_checks ? compileCheck(spec, specPath, "workflow.e2e", e2e.final_checks) : undefined;
  const limits = e2e.steps?.[stepId];
  return {
    ...(limits
      ? {
          e2eLimits: {
            ...(limits.max_cost_per_trial_usd !== undefined ? { maxCostPerTrialUsd: limits.max_cost_per_trial_usd } : {}),
            ...(limits.maximum_completion_time_seconds !== undefined ? { timeoutMs: limits.maximum_completion_time_seconds * 1000 } : {}),
          },
        }
      : {}),
    ...(e2e.inputs ? { e2eInputs: [...e2e.inputs] } : {}),
    ...(finalCheck ? { e2eFinalCheck: finalCheck } : {}),
    ...(e2e.judge
      ? {
          e2eJudge: {
            rubricFile: e2e.judge.rubric_file,
            ...(e2e.judge.show?.length ? { show: [...e2e.judge.show] } : {}),
            dimensions: [...(e2e.judge.dimensions ?? [])],
          },
        }
      : {}),
  };
}

/** A command candidate's version_files, hashed into its config (and so its trial identity). */
function withVersionSha(c: CandidateDef, taskRoot: string): CandidateDef {
  const files = c.cli?.version_files;
  if (!c.cli || !files || files.length === 0) return c;
  const parts = [...files].sort().map((rel) => {
    let content = "<missing>";
    try {
      content = readFileSync(path.resolve(taskRoot, rel), "utf-8");
    } catch {
      // A missing file hashes as missing; check-task names it.
    }
    return `${rel}:${sha256(content)}`;
  });
  return { ...c, cli: { ...c.cli, version_sha: sha256(parts.join("\n")) } };
}

function compileOneStep(spec: EvalSpec, specPath: string, specSha: string, taskRoot: string, step: EvalStep): Suite {
  const harness = spec["x-harness"]!;
  const { producer, promptFile, rubricFile } = stepOverrides(step, spec);
  const wanted = new Set(step.candidate_ids);
  const candidateDefs: Record<string, CandidateDef> = {};
  for (const c of spec.candidates) {
    if (wanted.has(c.id)) candidateDefs[c.id] = { ...withVersionSha(c, taskRoot), adapter: adapterIdOf(c, producer) };
  }
  const requiredChecks = step.required_checks ?? [];
  const check = compileCheck(spec, specPath, step.id, requiredChecks);

  return {
    suiteId: spec.run_name,
    step: step.id,
    producer,
    promptFile,
    rubricFile,
    candidates: [...step.candidate_ids],
    judge: spec.evaluators.judge.model,
    judgeMethods: judgeMethodsOf(spec, step.judge),
    ...((step.judge?.show ?? spec.evaluators.judge.show)?.length ? { judgeShow: step.judge?.show ?? spec.evaluators.judge.show } : {}),
    inputs: [...step.test_set.inputs],
    trials: spec.execution.trials_per_case,
    temperature: harness.default_temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: step.maximum_completion_time_seconds
      ? step.maximum_completion_time_seconds * 1000
      : DEFAULT_TIMEOUT_MS,
    check,
    dimensions: step.judge?.dimensions ?? step.judged_dimensions ?? [],
    human: spec.evaluators.human
      ? {
          rubricFile: spec.evaluators.human.rubric_file,
          method: spec.evaluators.human.method ?? "pairwise",
          show: spec.evaluators.human.show ?? [],
          dimensions: spec.evaluators.human.dimensions ?? step.judged_dimensions ?? [],
        }
      : undefined,

    candidateDefs,
    protocolVersion: spec.protocol_version,
    runName: spec.run_name,
    budgetUsd: spec.budget_usd,
    stepId: step.id,
    stepVersion: step.version,
    testSetId: step.test_set.id,
    requiredChecks,
    successCriteria: step.success_criteria,
    operatingMode: step.operating_mode,
    eligibility: step.eligibility,
    mmd: spec.execution.minimum_meaningful_difference ?? null,
    controlCandidate: spec.workflow.control_candidate,
    benchmarkMode: spec.execution.benchmark_mode ?? "capability-neutral",
    cacheMode: spec.execution.cache_mode ?? "cold",
    concurrency: step.concurrency ?? spec.execution.concurrency,
    specSha,
    specPath,
    taskRoot,
    inputFrom: step.input_from,
    ...(step.handoff ? { handoff: step.handoff } : {}),
    ...(step.max_cost_per_trial_usd !== undefined ? { maxCostPerTrialUsd: step.max_cost_per_trial_usd } : {}),
    ...(step.exit_code ? { exitCode: step.exit_code } : {}),
    ...e2eOf(spec, specPath, step.id),
    ...(step.test_set.fixture_dir ? { fixtureDir: step.test_set.fixture_dir } : {}),
    ...(spec.description ? { description: spec.description } : {}),
    ...(requiredChecks[0] && spec.evaluators.required_checks?.[requiredChecks[0]]?.description
      ? { checkDescription: spec.evaluators.required_checks[requiredChecks[0]].description }
      : {}),
    ...(step.test_set.labels_file ? { labelsFile: step.test_set.labels_file } : {}),
  };
}

/**
 * Compile every workflow step into its own Suite. Independent eval has no
 * handoff; `input_from` is for the e2e control pass.
 *
 * `taskRoot` is the directory the spec lives in — every asset it names
 * resolves there, and its runs are written there. It is passed in rather than
 * derived, so a caller compiling a spec it holds in memory (a test, a future
 * editor) states where that spec would live instead of guessing.
 */
export function compileWorkflow(spec: EvalSpec, specPath: string, specSha: string, taskRoot: string): Suite[] {
  checkSemantics(spec, specPath);
  return spec.workflow.steps.map((step) => compileOneStep(spec, specPath, specSha, taskRoot, step));
}

/** First step only — existing single-step callers. Use `compileWorkflow` for all steps. */
export function compileSpec(spec: EvalSpec, specPath: string, specSha: string, taskRoot: string): Suite {
  return compileWorkflow(spec, specPath, specSha, taskRoot)[0];
}

/**
 * Record a spec path the way a reader can act on it: relative to the
 * workspace it belongs to, so a manifest says `tasks/code-reactive/spec.yaml`
 * rather than a path that only existed on the machine that ran it.
 */
function specPathFor(ws: Workspace, abs: string): string {
  const rel = path.relative(ws.root, abs);
  return rel.startsWith("..") ? abs : rel;
}

export async function loadWorkflow(specPath: string): Promise<Suite[]> {
  if (/\.json$/i.test(specPath)) {
    throw new SpecError(
      `${specPath}: legacy suites/*.json is no longer supported; write tasks/<name>/spec.yaml instead (agenteval init <name> creates one)`,
    );
  }
  const abs = path.resolve(specPath);
  const ws = await workspaceForSpec(abs);
  const text = await fs.readFile(abs, "utf-8");
  const spec = parseSpec(text, specPath);
  return compileWorkflow(spec, specPathFor(ws, abs), sha256(text), path.dirname(abs));
}

export async function loadSpec(specPath: string): Promise<Suite> {
  return (await loadWorkflow(specPath))[0];
}
