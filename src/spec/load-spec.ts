/**
 * Spec loader — protocol-style YAML in, the harness's `Suite` out.
 *
 * The YAML is the user-facing, versioned source of truth (protocol §4). It is
 * validated against `SPEC_SCHEMA`, then compiled into the internal `Suite` so
 * `run.ts` keeps its control flow. Legacy `suites/*.json` still load through
 * `loadLegacySuite`, which synthesizes candidate definitions with id = model.
 *
 * This week a spec declares exactly one step; multi-step workflows arrive with
 * the end-to-end control in a later milestone.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { sha256 } from "../canon/hash.js";
import type { CandidateDef } from "../canon/types.js";
import { REPO_ROOT } from "../paths.js";
import type { Suite } from "../types.js";
import { SPEC_SCHEMA } from "./schema.js";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Static shape of a validated spec (mirrors SPEC_SCHEMA; kept loose on purpose). */
export interface EvalSpec {
  protocol_version: string;
  run_name: string;
  budget_usd?: number;
  workflow: {
    control_candidate?: string;
    steps: Array<{
      id: string;
      version: string;
      test_set: { id: string; inputs: string[] };
      candidate_ids: string[];
      required_checks?: string[];
      judged_dimensions?: string[];
      success_criteria?: { mandatory_checks: "all" };
      operating_mode?: string;
      maximum_completion_time_seconds?: number;
    }>;
  };
  candidates: CandidateDef[];
  evaluators: {
    required_checks?: Record<string, { kind: "tsc"; scaffold_dir?: string }>;
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

/** Semantic checks the schema cannot express. */
function checkSemantics(spec: EvalSpec, specPath: string): void {
  if (spec.workflow.steps.length !== 1) {
    throw new SpecError(`spec ${specPath}: exactly one workflow step is supported this milestone (got ${spec.workflow.steps.length})`);
  }
  const step = spec.workflow.steps[0];
  const byId = new Map(spec.candidates.map((c) => [c.id, c]));
  const dupes = spec.candidates.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i);
  if (dupes.length > 0) throw new SpecError(`spec ${specPath}: duplicate candidate ids ${dupes.join(", ")}`);

  const missing = step.candidate_ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new SpecError(`spec ${specPath}: step "${step.id}" references unknown candidate ids ${missing.join(", ")}`);
  }
  if (spec.workflow.control_candidate && !byId.has(spec.workflow.control_candidate)) {
    throw new SpecError(`spec ${specPath}: control_candidate "${spec.workflow.control_candidate}" is not a declared candidate`);
  }

  const judgeVendor = vendorOf(spec.evaluators.judge.model);
  const sameVendor = step.candidate_ids
    .map((id) => byId.get(id)!)
    .filter((c) => vendorOf(c.model) === judgeVendor)
    .map((c) => c.id);
  if (sameVendor.length > 0 && !spec["x-harness"]?.allow_same_vendor_judge) {
    throw new SpecError(
      `spec ${specPath}: judge ${spec.evaluators.judge.model} shares a vendor with candidate(s) ${sameVendor.join(", ")}; ` +
        `the protocol requires a cross-vendor judge (set x-harness.allow_same_vendor_judge to override deliberately)`,
    );
  }

  const declaredChecks = new Set(Object.keys(spec.evaluators.required_checks ?? {}));
  const undeclared = (step.required_checks ?? []).filter((c) => !declaredChecks.has(c));
  if (undeclared.length > 0) {
    throw new SpecError(`spec ${specPath}: required_checks ${undeclared.join(", ")} have no evaluator definition`);
  }

  const harness = spec["x-harness"];
  if (!harness) throw new SpecError(`spec ${specPath}: x-harness.producer is required this milestone`);
  if (harness.producer === "prompt" && !harness.prompt_file) {
    throw new SpecError(`spec ${specPath}: producer "prompt" needs x-harness.prompt_file`);
  }
}

/** Compile a validated spec into the harness Suite. Pure. */
export function compileSpec(spec: EvalSpec, specPath: string, specSha: string): Suite {
  checkSemantics(spec, specPath);
  const step = spec.workflow.steps[0];
  const harness = spec["x-harness"]!;
  const candidateDefs: Record<string, CandidateDef> = {};
  for (const c of spec.candidates) {
    if (step.candidate_ids.includes(c.id)) candidateDefs[c.id] = c;
  }
  const requiredChecks = step.required_checks ?? [];
  const tscCheck = requiredChecks
    .map((id) => spec.evaluators.required_checks?.[id])
    .find((def) => def?.kind === "tsc");

  return {
    suiteId: spec.run_name,
    step: step.id,
    producer: harness.producer,
    promptFile: harness.prompt_file,
    rubricFile: spec.evaluators.judge.rubric_file,
    candidates: [...step.candidate_ids],
    judge: spec.evaluators.judge.model,
    inputs: [...step.test_set.inputs],
    trials: spec.execution.trials_per_case,
    temperature: harness.default_temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: step.maximum_completion_time_seconds
      ? step.maximum_completion_time_seconds * 1000
      : DEFAULT_TIMEOUT_MS,
    check: tscCheck ? { scaffoldDir: tscCheck.scaffold_dir ?? "scaffold" } : undefined,
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
    mmd: spec.execution.minimum_meaningful_difference ?? null,
    controlCandidate: spec.workflow.control_candidate,
    benchmarkMode: spec.execution.benchmark_mode ?? "capability-neutral",
    cacheMode: spec.execution.cache_mode ?? "cold",
    concurrency: spec.execution.concurrency,
    specSha,
    specPath,
  };
}

export async function loadSpec(specPath: string): Promise<Suite> {
  const abs = path.resolve(REPO_ROOT, specPath);
  const text = await fs.readFile(abs, "utf-8");
  const spec = parseSpec(text, specPath);
  return compileSpec(spec, path.relative(REPO_ROOT, abs), sha256(text));
}

/** Legacy suites/*.json: candidate id = model id, provider implied (openrouter). */
export async function loadLegacySuite(suitePath: string): Promise<Suite> {
  const abs = path.resolve(REPO_ROOT, suitePath);
  const text = await fs.readFile(abs, "utf-8");
  const suite = JSON.parse(text) as Suite;
  const candidateDefs: Record<string, CandidateDef> = {};
  for (const model of suite.candidates) {
    candidateDefs[model] = { id: model, model, provider_route: "openrouter" };
  }
  return {
    ...suite,
    candidateDefs,
    requiredChecks: suite.check ? ["tsc-noemit"] : [],
    successCriteria: suite.check ? { mandatory_checks: "all" } : undefined,
    benchmarkMode: "capability-neutral",
    cacheMode: "cold",
    specSha: sha256(text),
    specPath: path.relative(REPO_ROOT, abs),
  };
}

/** Pick the loader by extension. */
export async function loadSuiteOrSpec(p: string): Promise<Suite> {
  return /\.ya?ml$/i.test(p) ? loadSpec(p) : loadLegacySuite(p);
}
