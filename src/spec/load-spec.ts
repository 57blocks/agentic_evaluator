/**
 * Spec loader — protocol-style YAML in, the harness's `Suite` out.
 *
 * The YAML is the user-facing, versioned source of truth (protocol §4). It is
 * validated against `SPEC_SCHEMA`, then compiled into the internal `Suite` so
 * `run.ts` keeps its control flow. Legacy `suites/*.json` still load through
 * `loadLegacySuite`, which synthesizes candidate definitions with id = model.
 *
 * Specs may declare several independent steps; each compiles to its own Suite.
 * Independent eval does not pipe output forward. Steps with `input_from` form
 * the single-model e2e control chain (protocol §8).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { adapterIdOf } from "../adapters/types.js";
import { orderControlChain } from "../canon/e2e.js";
import { sha256 } from "../canon/hash.js";
import type { CandidateDef, EligibilityDecl } from "../canon/types.js";
import type { CheckConfig, JudgeMethod } from "../types.js";
import { TSC_CHECK_ID } from "../check.js";
import { REPO_ROOT } from "../paths.js";
import type { Suite } from "../types.js";
import { SPEC_SCHEMA } from "./schema.js";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface EvalStep {
  id: string;
  version: string;
  test_set: { id: string; inputs: string[] };
  candidate_ids: string[];
  required_checks?: string[];
  judged_dimensions?: string[];
  success_criteria?: { mandatory_checks: "all" };
  operating_mode?: string;
  eligibility?: EligibilityDecl;
  maximum_completion_time_seconds?: number;
  /** Overrides x-harness.producer for this step. */
  producer?: "prompt" | "codegen";
  prompt_file?: string;
  rubric_file?: string;
  /** Prior step id whose output is this step's input during e2e control. Independent eval still uses test_set. */
  input_from?: string;
}

/** Static shape of a validated spec (mirrors SPEC_SCHEMA; kept loose on purpose). */
export interface EvalSpec {
  protocol_version: string;
  run_name: string;
  budget_usd?: number;
  workflow: {
    control_candidate?: string;
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
      }
    >;
    judge: { model: string; provider_route?: string; rubric_file: string; methods?: string[] };
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
export function vendorOf(modelId: string): string {
  return modelId.split("/")[0] ?? modelId;
}

export function parseSpec(text: string, specPath: string): EvalSpec {
  const data: unknown = parseYaml(text);
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
    rubricFile: step.rubric_file ?? spec.evaluators.judge.rubric_file,
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
}

const DEFAULT_CHECK_TIMEOUT_S = 120;
const ALL_JUDGE_METHODS: JudgeMethod[] = ["pairwise-swap", "absolute-1-5"];

/** Declared methods, or both when the spec is silent. */
function judgeMethodsOf(spec: EvalSpec): JudgeMethod[] {
  const declared = spec.evaluators.judge.methods;
  if (!declared || declared.length === 0) return [...ALL_JUDGE_METHODS];
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

function compileOneStep(spec: EvalSpec, specPath: string, specSha: string, step: EvalStep): Suite {
  const harness = spec["x-harness"]!;
  const { producer, promptFile, rubricFile } = stepOverrides(step, spec);
  const wanted = new Set(step.candidate_ids);
  const candidateDefs: Record<string, CandidateDef> = {};
  for (const c of spec.candidates) {
    if (wanted.has(c.id)) candidateDefs[c.id] = { ...c, adapter: adapterIdOf(c, producer) };
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
    judgeMethods: judgeMethodsOf(spec),
    inputs: [...step.test_set.inputs],
    trials: spec.execution.trials_per_case,
    temperature: harness.default_temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: step.maximum_completion_time_seconds
      ? step.maximum_completion_time_seconds * 1000
      : DEFAULT_TIMEOUT_MS,
    check,
    dimensions: step.judged_dimensions ?? [],

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
    concurrency: spec.execution.concurrency,
    specSha,
    specPath,
    taskRoot: path.dirname(path.resolve(REPO_ROOT, specPath)),
    inputFrom: step.input_from,
  };
}

/** Compile every workflow step into its own Suite. Independent eval has no handoff; `input_from` is for the e2e control pass. */
export function compileWorkflow(spec: EvalSpec, specPath: string, specSha: string): Suite[] {
  checkSemantics(spec, specPath);
  return spec.workflow.steps.map((step) => compileOneStep(spec, specPath, specSha, step));
}

/** First step only — existing single-step callers. Use `compileWorkflow` for all steps. */
export function compileSpec(spec: EvalSpec, specPath: string, specSha: string): Suite {
  return compileWorkflow(spec, specPath, specSha)[0];
}

export async function loadWorkflow(specPath: string): Promise<Suite[]> {
  const abs = path.resolve(REPO_ROOT, specPath);
  const text = await fs.readFile(abs, "utf-8");
  const spec = parseSpec(text, specPath);
  return compileWorkflow(spec, path.relative(REPO_ROOT, abs), sha256(text));
}

export async function loadSpec(specPath: string): Promise<Suite> {
  return (await loadWorkflow(specPath))[0];
}

/** Legacy suites/*.json: candidate id = model id, provider implied (openrouter). */
export async function loadLegacySuite(suitePath: string): Promise<Suite> {
  const abs = path.resolve(REPO_ROOT, suitePath);
  const text = await fs.readFile(abs, "utf-8");
  const parsed = JSON.parse(text) as Suite & { check?: { scaffoldDir?: string } };
  // Legacy JSON carries a bare { scaffoldDir }; give it the id and kind the
  // canonical layer now expects without touching the files on disk.
  const suite: Suite = {
    ...parsed,
    check: parsed.check ? { id: TSC_CHECK_ID, kind: "tsc", scaffoldDir: parsed.check.scaffoldDir ?? "scaffold" } : undefined,
  };
  const candidateDefs: Record<string, CandidateDef> = {};
  for (const model of suite.candidates) {
    candidateDefs[model] = {
      id: model,
      model,
      provider_route: "openrouter",
      adapter: suite.check ? "codegen" : "model-api",
    };
  }
  return {
    ...suite,
    candidateDefs,
    requiredChecks: suite.check ? [TSC_CHECK_ID] : [],
    successCriteria: suite.check ? { mandatory_checks: "all" } : undefined,
    benchmarkMode: "capability-neutral",
    cacheMode: "cold",
    specSha: sha256(text),
    specPath: path.relative(REPO_ROOT, abs),
    taskRoot: path.dirname(abs),
  };
}

/** Pick the loader by extension. YAML may contain several independent steps. */
export async function loadSuites(p: string): Promise<Suite[]> {
  return /\.ya?ml$/i.test(p) ? loadWorkflow(p) : [await loadLegacySuite(p)];
}

/** First (or only) step. Prefer `loadSuites` when the spec may be multi-step. */
export async function loadSuiteOrSpec(p: string): Promise<Suite> {
  return (await loadSuites(p))[0];
}
