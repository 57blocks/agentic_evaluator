/**
 * `agenteval check-task`: what can be known about a task before a run is paid.
 *
 * A run tells you which candidate won; it cannot tell you the task was able
 * to tell them apart. This answers that first, for free — no key, no model
 * call, nothing written outside the task's `runs/`:
 *
 *   inputs      how many, empty or duplicated, and how far a pass rate can
 *               move by chance at that size
 *   check       an empty answer must fail; each reference answer must pass
 *   candidates  a declared script that does not exist; a command running on
 *               the host where it can read the answer key
 *   step        a step that can never qualify anyone
 *
 * Findings are `blocking` (the run would measure the wrong thing), `warning`
 * (it would be weaker than it looks) or `ok`.
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { adapterIdOf } from "../adapters/types.js";
import { sha256 } from "../canon/hash.js";
import { directionality } from "../canon/rates.js";
import { resolveEligibility } from "../canon/select.js";
import { inputsToClearGate, minDetectableGap, wilson } from "../canon/stats.js";
import { matchesShow } from "../canon/review.js";
import { fixturePath, isDir } from "./fixture.js";
import { restoreAnswerKey } from "./answer-key.js";
import { e2eChain, e2eRootInputs } from "./plan.js";
import { readInput } from "./generate.js";
import { envRefs } from "../adapters/agent-cli.js";
import type { CandidateDef } from "../canon/types.js";
import { taskInputPath } from "../paths.js";
import { looksLikePath } from "../script-path.js";
import { loadWorkflow } from "../spec/load-spec.js";
import type { Suite } from "../types.js";
import { probeCheck } from "./preflight-check.js";

export type Severity = "blocking" | "warning" | "ok";

export interface Finding {
  severity: Severity;
  /** Stable id, e.g. "check.null", for scripts and the authoring skill. */
  code: string;
  message: string;
}

export interface PreflightReport {
  spec: string;
  steps: Array<{ step: string; findings: Finding[] }>;
  blocking: number;
  warnings: number;
}

/** Trials per case when the spec does not say (matches the run default). */
const DEFAULT_TRIALS = 2;

interface LoadedInput {
  slug: string;
  text: string;
}

async function loadInputs(suite: Suite): Promise<LoadedInput[]> {
  return Promise.all(
    suite.inputs.map(async (slug) => ({ slug, text: await fs.readFile(taskInputPath(suite.taskRoot, slug), "utf-8") })),
  );
}

function inputFindings(suite: Suite, inputs: readonly LoadedInput[]): Finding[] {
  const out: Finding[] = [];
  const empty = inputs.filter((i) => i.text.trim() === "").map((i) => i.slug);
  if (empty.length > 0) out.push({ severity: "blocking", code: "inputs.empty", message: `empty input(s): ${empty.join(", ")}` });

  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const i of inputs) {
    const key = sha256(i.text.trim());
    const first = seen.get(key);
    if (first) dupes.push(`${i.slug} = ${first}`);
    else seen.set(key, i.slug);
  }
  if (dupes.length > 0) out.push({ severity: "warning", code: "inputs.duplicate", message: `same text as another input: ${dupes.join(", ")}` });

  const n = inputs.length;
  const trials = suite.trials ?? DEFAULT_TRIALS;
  const dir = directionality(n, suite.mmd);
  const gap = minDetectableGap(n);
  const size =
    `${n} input${n === 1 ? "" : "s"} × ${trials} trial${trials === 1 ? "" : "s"}` +
    (gap === null
      ? ""
      : `: the smallest gap between two candidates that can come out firm is ${Math.round(gap * 100)} points, and only if every input that differs goes the same way; real gaps need more`);
  out.push(
    dir.directional
      ? { severity: "warning", code: "inputs.count", message: `${size}; results will be directional (${dir.reasons.join("; ")})` }
      : { severity: "ok", code: "inputs.count", message: size },
    ...gateFindings(suite, n),
  );
  return out;
}

/**
 * A gate the set is too small to back: even a candidate that passes every
 * input has a 95% interval reaching below it, so the pick can never be firm.
 */
function gateFindings(suite: Suite, n: number): Finding[] {
  const e = resolveEligibility(suite.requiredChecks ?? [], suite.eligibility);
  const low = wilson(n, n)?.low ?? 0;
  const gates: Array<[string, number | null]> = [
    ["minimum_required_check_pass_rate", e.minimum_required_check_pass_rate],
    ["minimum_reliability", e.minimum_reliability],
    ["minimum_all_trials_pass_rate", e.minimum_all_trials_pass_rate],
  ];
  return gates
    .filter((g): g is [string, number] => g[1] !== null && low + 1e-12 < g[1])
    .map(([name, gate]) => {
      const need = inputsToClearGate(gate);
      const fix =
        need === null
          ? "a gate of 1 can never be firm; declare one such as 0.95 (needs 73 inputs) or 0.9 (needs 35)"
          : `it needs at least ${need} inputs, or a lower gate`;
      return {
        severity: "warning",
        code: "eligibility.unreachable",
        message: `${name} ${gate}: a candidate passing ${n === 1 ? "its one input" : `all ${n} inputs`} still has a 95% interval down to ${low.toFixed(3)}, so the pick cannot be firm; ${fix}`,
      };
    });
}

/** `${NAME}` in cli.env that this environment (with .env.local) does not set. */
function cliEnvFindings(id: string, env: Record<string, string>): Finding[] {
  const missing = [...new Set(Object.values(env).flatMap(envRefs))].filter((n) => process.env[n] === undefined);
  return missing.length === 0
    ? []
    : [{ severity: "blocking", code: "candidate.env-missing", message: `${id}: cli.env needs ${missing.join(", ")}, which is not set (export it, or put it in .env.local)` }];
}

/** Spend reporting and the per-trial cap a command is handed. */
function usageFindings(suite: Suite, id: string, def: CandidateDef): Finding[] {
  const out: Finding[] = [];
  if (def.cli?.reports_usage === "tokens" && !def.model && !def.price) {
    out.push({ severity: "warning", code: "candidate.unpriced", message: `${id}: reports tokens but has no model or price, so its cost stays unobserved` });
  }
  if (def.cli?.argv.some((a) => a.includes("{{max_cost_usd}}")) && suite.maxCostPerTrialUsd === undefined) {
    out.push({ severity: "blocking", code: "candidate.no-cost-cap", message: `${id}: argv uses {{max_cost_usd}} but step ${suite.step} declares no max_cost_per_trial_usd` });
  }
  return out;
}

function candidateFindings(suite: Suite): Finding[] {
  const out: Finding[] = [];
  const onHost: string[] = [];
  for (const [id, def] of Object.entries(suite.candidateDefs ?? {})) {
    if (adapterIdOf(def, suite.producer ?? "prompt") !== "agent-cli" || !def.cli) continue;
    // Same rule the adapter uses to resolve a declared script against the task.
    const missing = def.cli.argv.filter(
      (arg) => !path.isAbsolute(arg) && !arg.includes("{{") && looksLikePath(arg) && !existsSync(path.resolve(suite.taskRoot, arg)),
    );
    for (const arg of missing) {
      out.push({ severity: "blocking", code: "candidate.script-missing", message: `${id}: declared script ${arg} not found in ${suite.taskRoot}` });
    }
    if (!def.cli.image) onHost.push(id);
    out.push(...cliEnvFindings(id, def.cli.env ?? {}), ...usageFindings(suite, id, def));
  }
  if (onHost.length > 0 && suite.check) {
    out.push({
      severity: "warning",
      code: "candidate.host-reads-answers",
      message: `${onHost.join(", ")} run on this machine without an image: they can read the task's checks/ and rubrics/ (references/ is unreadable while a run is in flight, which stops an agent that looks, not one that breaks out). Give them cli.image to keep all of it out of reach.`,
    });
  }
  return out;
}

function stepFindings(suite: Suite): Finding[] {
  const checks = suite.requiredChecks ?? [];
  if (checks.length === 0 && suite.operatingMode !== "judge-preference") {
    return [{
      severity: "blocking",
      code: "step.no-checks",
      message: `no required checks and operating mode ${suite.operatingMode ?? "(none)"}: every trial is undetermined, so no candidate can qualify. Declare a check, or use judge-preference.`,
    }];
  }
  return [];
}

/**
 * A step's reference files, as (input, path within the answer, bytes):
 * references/<step>/<input>/... when that exists, else references/<input>/...
 * (the layout check-task's oracle probe reads).
 */
async function referenceFilesOf(suite: Suite): Promise<Array<{ input: string; rel: string; bytes: number }>> {
  const root = path.join(suite.taskRoot, "references");
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
  const out: Array<{ input: string; rel: string; bytes: number }> = [];
  for (const e of entries.filter((x) => x.isFile())) {
    const parts = path.relative(root, path.join(e.parentPath, e.name)).split(path.sep);
    const perStep = parts[0] === suite.step && parts.length > 2;
    const [input, ...rest] = perStep ? parts.slice(1) : parts;
    if (input === undefined || rest.length === 0) continue;
    // A per-step layout's files belong to that step alone.
    if (!perStep && suite.inputs.length > 0 && !suite.inputs.includes(input)) continue;
    out.push({ input, rel: rest.join("/"), bytes: (await fs.stat(path.join(e.parentPath, e.name))).size });
  }
  return out;
}

/** evaluators.human: the rubric exists, and `show` picks something out of a correct answer. */
async function reviewFindings(suite: Suite): Promise<Finding[]> {
  const human = suite.human;
  if (!human) return [];
  const out: Finding[] = [];
  if (!existsSync(path.resolve(suite.taskRoot, human.rubricFile))) {
    out.push({ severity: "blocking", code: "review.rubric-missing", message: `human review rubric ${human.rubricFile} not found in ${suite.taskRoot}` });
  }
  if (human.show.length > 0) {
    const files = (await referenceFilesOf(suite)).map((f) => f.rel);
    if (files.length > 0 && !files.some((f) => matchesShow(f, human.show))) {
      out.push({ severity: "warning", code: "review.show-empty", message: `human review show [${human.show.join(", ")}] matches no file in references/: a reviewer would see nothing to compare` });
    }
  }
  return out;
}

/**
 * evaluators.judge.show: it picks something out of a correct answer, and how
 * much of it the judge would read (a whole project can overrun its context).
 */
async function judgeShowFindings(suite: Suite): Promise<Finding[]> {
  const show = suite.judgeShow;
  if (!show || show.length === 0 || (suite.judgeMethods ?? []).length === 0) return [];
  const files = await referenceFilesOf(suite);
  const bytesByInput = new Map<string, number>();
  for (const f of files.filter((x) => matchesShow(x.rel, show))) {
    bytesByInput.set(f.input, (bytesByInput.get(f.input) ?? 0) + f.bytes);
  }
  if (files.length === 0) return [];
  if (bytesByInput.size === 0) {
    return [{ severity: "warning", code: "judge.show-empty", message: `judge show [${show.join(", ")}] matches no file in references/: the judge would read nothing` }];
  }
  const sizes = [...bytesByInput].map(([input, bytes]) => `${input} ${Math.round(bytes / 1024)} KB`).join(", ");
  return [{ severity: "ok", code: "judge.show", message: `judge reads per answer: ${sizes} (about 1 token per 4 bytes)` }];
}

/** fixture_dir: every input has its directory, and an agent is there to start from it. */
async function fixtureFindings(suite: Suite): Promise<Finding[]> {
  if (!suite.fixtureDir) return [];
  const missing: string[] = [];
  for (const slug of suite.inputs) {
    const dir = fixturePath(suite, slug);
    if (dir && !(await isDir(dir))) missing.push(slug);
  }
  const out: Finding[] = [];
  if (missing.length > 0) {
    out.push({ severity: "blocking", code: "inputs.fixture-missing", message: `no fixture under ${suite.fixtureDir}/ for ${missing.join(", ")}: those candidates would start from an empty work dir` });
  }
  const notAgents = suite.candidates.filter((c) => (suite.candidateDefs?.[c]?.adapter ?? "") !== "agent-cli");
  if (notAgents.length > 0) {
    out.push({ severity: "warning", code: "inputs.fixture-unused", message: `${notAgents.join(", ")} ${notAgents.length === 1 ? "is not a command" : "are not commands"}: only agent-cli candidates start from the fixture` });
  }
  return out;
}

async function preflightStep(suite: Suite, opts: { keep?: boolean }): Promise<Finding[]> {
  const findings: Finding[] = [
    ...stepFindings(suite),
    ...candidateFindings(suite),
    ...(await reviewFindings(suite)),
    ...(await judgeShowFindings(suite)),
    ...(await fixtureFindings(suite)),
  ];
  if (suite.inputFrom) {
    // Evaluated on its own inputs like any step; only the e2e arms hand it the previous step's output.
    findings.push({ severity: "ok", code: "inputs.from-step", message: `in the end-to-end arms its input is step ${suite.inputFrom}'s ${suite.handoff === "workdir" ? "work dir" : "output"}; on its own it is evaluated on the inputs below` });
  }
  const inputs = await loadInputs(suite);
  findings.push(...inputFindings(suite, inputs));
  if (suite.check) findings.push(...(await probeCheck(suite, inputs, opts)));
  return findings;
}

/**
 * workflow.e2e.final_checks, probed like a step's check: the chain's starting
 * state (the first step's fixture, nothing delivered) must fail, and
 * references/e2e/<input>/ — a delivered end product — must pass.
 */
async function e2eFindings(suites: readonly Suite[], opts: { keep?: boolean }): Promise<Finding[] | null> {
  const chain = e2eChain(suites);
  const last = chain?.[chain.length - 1];
  if (!chain || !last?.e2eFinalCheck) return null;
  const root = chain[0]!;
  const probe: Suite = { ...root, step: "e2e", check: last.e2eFinalCheck, requiredChecks: [last.e2eFinalCheck.id] };
  const inputs = await Promise.all(e2eRootInputs(root).map(async (slug) => ({ slug, text: await readInput(slug, root.taskRoot).catch(() => "") })));
  return probeCheck(probe, inputs, opts);
}

export async function preflightTask(specPath: string, opts: { keep?: boolean } = {}): Promise<PreflightReport> {
  const suites = await loadWorkflow(specPath);
  const steps: PreflightReport["steps"] = [];
  // A run that was killed outright leaves references/ unreadable (answer-key.ts).
  const recovered = suites.length > 0 && restoreAnswerKey(suites[0]!.taskRoot);
  for (const suite of suites) steps.push({ step: suite.stepId ?? suite.step, findings: await preflightStep(suite, opts) });
  const e2e = await e2eFindings(suites, opts);
  if (e2e) steps.push({ step: "e2e", findings: e2e });
  if (recovered) {
    steps[0]!.findings.unshift({ severity: "warning", code: "references.restored", message: "references/ was left unreadable by an interrupted run; made readable again" });
  }
  const all = steps.flatMap((s) => s.findings);
  return {
    spec: specPath,
    steps,
    blocking: all.filter((f) => f.severity === "blocking").length,
    warnings: all.filter((f) => f.severity === "warning").length,
  };
}
