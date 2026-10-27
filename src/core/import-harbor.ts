/**
 * `agenteval import-harbor <job-dir> --into tasks/<name>`: a finished Harbor
 * job as agenteval evidence, with nothing re-run (Harbor comparison doc,
 * option 1).
 *
 * A Harbor job dir holds one trial dir per (task, trial) with `result.json`
 * (who ran, the verifier's reward, the agent's own spend, any exception) and
 * `agent/trajectory.json` (ATIF). The import writes a **task** — a spec
 * naming the agents seen as command candidates and the Harbor tasks as
 * inputs, with the spike's `harbor-run.sh`, `reward.mjs` and rubric beside
 * it, so the task can also be run afresh — and one **run** under it, so
 * `agenteval report` and the dashboard work unchanged.
 *
 * Mapping, each the same rule the spike's `checks/reward.mjs` applies:
 *   exception_info      AgentTimeoutError → timeout, NonZeroAgentExitCodeError
 *                       → malformed (the candidate's own); any other → a
 *                       provider error (Harbor's: auth, environment, verifier)
 *   verifier reward     ≥ threshold → pass, below → fail; a missing reward is
 *                       an evaluator error, never the candidate's failure
 *                       (Harbor's own mean counts it as 0)
 *   agent_result        cost and tokens as the agent reported, "estimated";
 *                       absent → unobserved
 *   environment.type    isolation
 *   trajectory.json     the trace, through the ATIF reader
 *
 * The trial hash carries producer version "harbor-import", so a later real
 * run of the generated task never serves an imported trial as its own. That
 * version string is what keeps the two apart; the config sha below also
 * differs from a real run's (it includes `trace`, which trialAdapterFields
 * strips), but nothing should rely on that.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { buildLedger } from "../canon/cost.js";
import { judgeDiscrimination } from "../canon/discrimination.js";
import { buildManifest } from "../canon/manifest.js";
import { directionality, ratesFor } from "../canon/rates.js";
import { sha256, trialHash } from "../canon/hash.js";
import { activityOf, TraceError, type AgentTrace } from "../canon/agent-trace.js";
import { toEvaluationRows, toTrialRows } from "../canon/adapt.js";
import { evaluationCoverage, writeCanonBundle, writeManifest, type CanonSummary } from "../canon/write.js";
import type { CompletionState, EvaluationState, Isolation } from "../canon/types.js";
import { parseAtif } from "../traces/atif.js";
import { judgePromptTemplateSha, PAIRWISE_EVALUATOR_ID } from "../judge.js";
import { scorePromptTemplateSha, ABSOLUTE_EVALUATOR_ID } from "../score.js";
import { commandCheckVersion } from "../check.js";
import { loadSpec } from "../spec/load-spec.js";
import { writeRunReport } from "../report-v2.js";
import { fixturesDir } from "../paths.js";
import { safeName } from "./generate.js";
import { runsRootFor } from "./workspace.js";
import type { RunRecord } from "../types.js";

export const CHECK_ID = "harbor-reward";
export const DEFAULT_THRESHOLD = 1;
/** Deeper than this a result.json is some other file: Harbor writes <job>/<trial>/result.json. */
const MAX_RESULT_DEPTH = 3;
const PRODUCER_VERSION = "harbor-import";

/** The fields of a Harbor trial's result.json that the import reads. */
export interface HarborTrial {
  task_name?: string;
  trial_name?: string;
  started_at?: string;
  finished_at?: string;
  agent_info?: { name?: string; version?: string; model_info?: { name?: string; provider?: string } | null } | null;
  agent_result?: { n_input_tokens?: number; n_cache_tokens?: number; n_output_tokens?: number; cost_usd?: number | null } | null;
  verifier_result?: { rewards?: Record<string, number> | null } | null;
  exception_info?: { exception_type?: string; exception_message?: string } | null;
  /** The agent's own run, inside the trial's setup and verification. */
  agent_execution?: { started_at?: string; finished_at?: string } | null;
  config?: { agent?: { name?: string; model_name?: string | null }; environment?: { type?: string } };
}

/** Harbor exceptions that are the candidate's own doing; everything else is Harbor's. */
const CANDIDATE_EXCEPTIONS: Record<string, CompletionState> = {
  AgentTimeoutError: "timeout",
  NonZeroAgentExitCodeError: "malformed",
};

export interface ImportOptions {
  into: string;
  mode?: string;
  threshold?: number;
  html?: boolean;
  /** Overwrite an existing task dir. */
  force?: boolean;
}

export interface ImportResult {
  taskDir: string;
  runDir: string;
  candidates: string[];
  inputs: string[];
  trials: number;
  chosen: string | null;
  firmness: string;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");

// A job dir is untrusted input: its task names become file names and its
// agent and model names go into the generated spec. Anything outside these
// shapes is refused rather than written.
const TASK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const AGENT_OR_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function checkedNames(t: HarborTrial, dir: string): { task: string; agent: string; model: string | null } {
  const task = t.task_name ?? "";
  const agent = t.config?.agent?.name ?? t.agent_info?.name ?? "";
  const model = t.config?.agent?.model_name ?? t.agent_info?.model_info?.name ?? null;
  if (!TASK_NAME.test(task) || task.includes("..")) throw new Error(`${dir}: task_name ${JSON.stringify(task)} is not a plain name`);
  if (!AGENT_OR_MODEL.test(agent)) throw new Error(`${dir}: agent name ${JSON.stringify(agent)} is not a plain name`);
  if (model !== null && (!AGENT_OR_MODEL.test(model) || model.includes(".."))) throw new Error(`${dir}: model name ${JSON.stringify(model)} is not a plain name`);
  return { task, agent, model };
}

/** `terminus-2` + `openrouter/anthropic/claude-sonnet-5` → `terminus-2--anthropic-claude-sonnet-5`. */
export function candidateIdOf(t: HarborTrial): string {
  const agent = t.config?.agent?.name ?? t.agent_info?.name ?? "agent";
  const model = t.config?.agent?.model_name ?? t.agent_info?.model_info?.name ?? null;
  return model ? `${slug(agent)}--${slug(model.replace(/^openrouter\//, ""))}` : slug(agent);
}

interface Found {
  dir: string;
  trial: HarborTrial;
}

async function findTrials(jobDir: string): Promise<Found[]> {
  const out: Found[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isFile() && e.name === "result.json") {
        try {
          out.push({ dir, trial: JSON.parse(await fs.readFile(abs, "utf-8")) as HarborTrial });
        } catch {
          // Not a trial result; a job dir has other JSON too.
        }
      } else if (e.isDirectory() && depth < MAX_RESULT_DEPTH && e.name !== "agent" && e.name !== "verifier") {
        await walk(abs, depth + 1);
      }
    }
  }
  await walk(jobDir, 0);
  return out.filter((f) => typeof f.trial.task_name === "string" && f.trial.config?.agent !== undefined).sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The verdict `checks/reward.mjs` would give, and its evidence. */
export function rewardVerdict(t: HarborTrial, threshold: number): { state: EvaluationState; evidence: string; reason?: string } {
  const rewards = t.verifier_result?.rewards ?? null;
  const reward = typeof rewards?.reward === "number" ? rewards.reward : null;
  const exception = t.exception_info?.exception_type ?? null;
  const usage = t.agent_result ?? {};
  const evidence = [
    `task=${t.task_name} agent=${t.agent_info?.name ?? t.config?.agent?.name} model=${t.agent_info?.model_info?.name ?? t.config?.agent?.model_name ?? "-"}`,
    `rewards=${JSON.stringify(rewards)}`,
    `exception=${exception ?? "none"}`,
    `harbor-reported cost_usd=${usage.cost_usd ?? "null"} tokens in/out=${usage.n_input_tokens ?? "null"}/${usage.n_output_tokens ?? "null"}`,
  ].join("\n");
  if (reward === null) {
    if (exception !== null && exception in CANDIDATE_EXCEPTIONS) return { state: "fail", evidence, reason: `agent error: ${exception}` };
    return { state: "evaluator_error", evidence, reason: `no reward (${exception ?? "verifier wrote none"})` };
  }
  if (reward >= threshold) return { state: "pass", evidence };
  return { state: "fail", evidence, reason: `reward ${reward} < ${threshold}` };
}

function completionOf(t: HarborTrial): { state: CompletionState; finishReason: string; error?: string } {
  const exception = t.exception_info?.exception_type ?? null;
  if (exception === null) return { state: "success", finishReason: "stop" };
  const own = CANDIDATE_EXCEPTIONS[exception];
  const message = `${exception}${t.exception_info?.exception_message ? `: ${t.exception_info.exception_message}` : ""}`;
  if (own) return { state: own, finishReason: own === "timeout" ? "timeout" : "exit 1", error: message };
  return { state: "provider_error", finishReason: "error", error: `harbor: ${message}` };
}

const ms = (a?: string, b?: string): number => {
  const d = a && b ? Date.parse(b) - Date.parse(a) : NaN;
  return Number.isFinite(d) && d >= 0 ? d : 0;
};

async function traceOf(dir: string): Promise<{ trace?: AgentTrace; error?: string }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, "agent", "trajectory.json"), "utf-8");
  } catch {
    return {};
  }
  try {
    return { trace: parseAtif(JSON.parse(text)) };
  } catch (err) {
    return { error: `agent/trajectory.json unreadable as atif: ${err instanceof TraceError ? err.message : "not JSON"}` };
  }
}

// ── the generated task ───────────────────────────────────────────────────

function specText(name: string, candidates: ReadonlyMap<string, { agent: string; model: string | null }>, inputs: readonly string[], mode: string, threshold: number): string {
  const cands = [...candidates]
    .map(
      ([id, c]) => `  - id: ${JSON.stringify(id)}
    adapter: agent-cli
    cli:
      argv: [bash, agents/harbor-run.sh, ${JSON.stringify(c.agent)}, ${JSON.stringify(c.model ?? "")}, "{{input}}"]
      reports_usage: true
      trace: atif`,
    )
    .join("\n");
  return `# ${name} — imported from a Harbor job by \`agenteval import-harbor\`.
#
# The run beside this spec was not produced by agenteval: its trials are
# Harbor's, read from the job's result.json and agent/trajectory.json files
# (see the run's GAPS.md). The spec is runnable all the same: each candidate
# runs its Harbor agent on the task through agents/harbor-run.sh, as
# tasks/harbor-spike does.

protocol_version: "0.3"
run_name: ${JSON.stringify(name)}
budget_usd: 1

workflow:
  steps:
    - id: harbor
      version: "1"
      test_set:
        id: ${JSON.stringify(`${name}-v1`)}
        inputs: [${inputs.map((i) => JSON.stringify(i)).join(", ")}]
      candidate_ids: [${[...candidates.keys()].map((c) => JSON.stringify(c)).join(", ")}]
      required_checks: [${CHECK_ID}]
      judged_dimensions: []
      success_criteria:
        mandatory_checks: all
      operating_mode: ${mode}
      # An imported run has the trials Harbor ran, no more: gates of 1.0 would
      # leave almost any comparison with no recommendation. Rank instead, and
      # let the firmness label say how much the sample supports it.
      eligibility:
        minimum_reliability: 0
        minimum_required_check_pass_rate: 0
      maximum_completion_time_seconds: 3000
      exit_code: ignore

candidates:
${cands}

evaluators:
  required_checks:
    ${CHECK_ID}:
      kind: command
      argv: [node, checks/reward.mjs]
      version_files: [checks/reward.mjs, agents/harbor-run.sh]
      timeout_seconds: 30
      description: "Harbor's verifier rewarded the trial at least ${threshold}; a missing reward is an evaluator error, not a failure."
  judge:
    # Declared because the schema requires one; never called: the verifier decides.
    model: google/gemini-3.1-pro-preview
    provider_route: openrouter
    rubric_file: rubrics/harbor.md
    methods: []

execution:
  trials_per_case: 1
  concurrency: 3

x-harness:
  producer: codegen
  default_temperature: 0.2
`;
}

/** The spike's wrapper, check and rubric, shipped with the harness as the Harbor fixture. */
async function layTaskFiles(taskDir: string, inputs: readonly string[]): Promise<void> {
  const spike = path.join(fixturesDir(), "harbor-spike");
  for (const rel of ["agents/harbor-run.sh", "checks/reward.mjs", "rubrics/harbor.md"]) {
    const dest = path.join(taskDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(spike, rel), dest);
  }
  await fs.mkdir(path.join(taskDir, "inputs"), { recursive: true });
  for (const input of inputs) await fs.writeFile(path.join(taskDir, "inputs", `${input}.txt`), `${input}\n`, "utf-8");
}

// ── the import ───────────────────────────────────────────────────────────

export async function importHarborJob(jobDir: string, opts: ImportOptions): Promise<ImportResult> {
  const found = await findTrials(jobDir);
  if (found.length === 0) throw new Error(`no Harbor trial (a result.json with task_name and config.agent) under ${jobDir}`);
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const mode = opts.mode ?? "highest-assurance";
  const taskDir = path.resolve(opts.into);
  const name = path.basename(taskDir);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw new Error(`task name "${name}" must be lowercase letters, digits and dashes`);
  if (!opts.force && (await fs.stat(taskDir).then(() => true, () => false))) throw new Error(`${taskDir} exists (--force to overwrite its spec and files; runs are kept)`);

  const candidates = new Map<string, { agent: string; model: string | null }>();
  const inputs: string[] = [];
  for (const { dir, trial } of found) {
    const { task, agent, model } = checkedNames(trial, dir);
    const id = candidateIdOf(trial);
    if (!candidates.has(id)) candidates.set(id, { agent, model });
    if (!inputs.includes(task)) inputs.push(task);
  }

  await fs.mkdir(taskDir, { recursive: true });
  await layTaskFiles(taskDir, inputs);
  await fs.writeFile(path.join(taskDir, "spec.yaml"), specText(name, candidates, inputs, mode, threshold), "utf-8");
  const suite = await loadSpec(path.join(taskDir, "spec.yaml"));

  // Trials, numbered in the order Harbor's dirs sort, per (candidate, input).
  const counter = new Map<string, number>();
  const records: RunRecord[] = [];
  const traces = new Map<string, AgentTrace>();
  const startedAt = found.map((f) => f.trial.started_at).filter((s): s is string => typeof s === "string").sort()[0] ?? new Date().toISOString();
  const check = suite.check;
  if (!check || check.kind !== "command") throw new Error("the generated spec declares a command check; this is a harness bug");
  const checkVersion = await commandCheckVersion(check.argv, check.versionFiles, suite.taskRoot);
  for (const { dir, trial } of found) {
    const candidate = candidateIdOf(trial);
    const input = trial.task_name!;
    const key = `${candidate}\u0000${input}`;
    const n = counter.get(key) ?? 0;
    counter.set(key, n + 1);
    const completion = completionOf(trial);
    const verdict = rewardVerdict(trial, threshold);
    const usage = trial.agent_result ?? null;
    const traced = await traceOf(dir);
    const promptTokens = (usage?.n_input_tokens ?? 0) + (usage?.n_cache_tokens ?? 0);
    const record: RunRecord = {
      candidate,
      inputSlug: input,
      trial: n,
      text: verdict.evidence,
      promptTokens,
      completionTokens: usage?.n_output_tokens ?? 0,
      cachedTokens: usage?.n_cache_tokens,
      costUsd: typeof usage?.cost_usd === "number" ? usage.cost_usd : 0,
      costSource: typeof usage?.cost_usd === "number" ? "estimated" : "none",
      // The agent's own time; the whole trial (setup, verifier) when Harbor did not split it.
      ms: ms(trial.agent_execution?.started_at ?? trial.started_at, trial.agent_execution?.finished_at ?? trial.finished_at),
      status: completion.state === "success" ? "ok" : "error",
      error: completion.error,
      checkPassed: verdict.state === "pass",
      checkOutput: verdict.evidence,
      checkReason: verdict.reason,
      checkState: verdict.state,
      checkVersion,
      modelRef: candidates.get(candidate)?.model ?? `cli:${candidates.get(candidate)?.agent}`,
      deploymentRef: `harbor/${slug(trial.agent_info?.model_info?.provider ?? trial.config?.environment?.type ?? "harbor")}`,
      trialHash: trialHash({
        producer: "codegen",
        producerVersion: PRODUCER_VERSION,
        promptTemplateSha: sha256(PRODUCER_VERSION),
        inputSha: sha256(input),
        model: candidate,
        temperature: 0,
        trial: n,
        adapter: "agent-cli",
        adapterConfigSha: sha256(JSON.stringify(suite.candidateDefs?.[candidate]?.cli ?? {})),
      }),
      completionState: completion.state,
      truncated: false,
      finishReason: completion.finishReason,
      isolation: (trial.config?.environment?.type === "docker" ? "docker" : "none") as Isolation,
      ...(traced.trace ? { agent: activityOf(traced.trace) } : {}),
      ...(traced.error ? { traceError: traced.error } : {}),
    };
    records.push(record);
    if (traced.trace) traces.set(`${safeName(candidate)}__${input}__t${n}`, traced.trace);
  }

  // The run, written as a run of this task.
  const runId = `${name}-imported-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(runsRootFor(taskDir), runId);
  await fs.mkdir(runDir, { recursive: true });
  const rubric = await fs.readFile(path.join(taskDir, suite.rubricFile), "utf-8");
  const manifest = await buildManifest(suite, {
    runId,
    startedAt,
    concurrency: 1,
    inputShas: Object.fromEntries(inputs.map((i) => [i, sha256(i)])),
    rubricSha: sha256(rubric),
    producerTemplateSha: sha256(PRODUCER_VERSION),
    judgeTemplateSha: judgePromptTemplateSha(rubric, []),
    scoreTemplateSha: scorePromptTemplateSha(rubric, []),
    checkVersion,
  });
  manifest.finished_at = new Date().toISOString();
  await writeManifest(runDir, manifest);
  const adapt = {
    runId,
    step: suite.step,
    requiredChecks: suite.requiredChecks ?? [],
    successCriteria: suite.successCriteria,
    checkId: CHECK_ID,
    pairwiseId: PAIRWISE_EVALUATOR_ID,
    absoluteId: ABSOLUTE_EVALUATOR_ID,
    versions: { check: checkVersion, pairwise: "not-run", absolute: "not-run" },
    records,
    judgements: [],
    judgeFailures: [],
    skippedPairs: [],
    scores: [],
    scoreFailures: [],
  };
  const trials = toTrialRows(adapt);
  const evaluations = toEvaluationRows(adapt);
  const summary: CanonSummary = {
    run: runId,
    step: suite.step,
    inputs,
    candidates: [...candidates.keys()].map((c) => ratesFor(c, trials)),
    directionality: directionality(inputs.length, null),
    integrity: { events: 0, gaps_over_threshold: 0, longest_gap_ms: 0, threshold_ms: 0, wall_ms: 0, in_flight_gaps: 0 },
    judge_discrimination: judgeDiscrimination(trials),
    evaluation_coverage: evaluationCoverage(evaluations),
  };
  const ledger = buildLedger(trials, evaluations, PAIRWISE_EVALUATOR_ID, ABSOLUTE_EVALUATOR_ID);
  const recommendation = await writeCanonBundle(runDir, { manifest, trials, evaluations, ledger, summary });
  await fs.mkdir(path.join(runDir, "raw"), { recursive: true });
  for (const r of records) await fs.writeFile(path.join(runDir, "raw", `${safeName(r.candidate)}__${r.inputSlug}__t${r.trial}.txt`), r.text, "utf-8");
  if (traces.size > 0) {
    await fs.mkdir(path.join(runDir, "traces"), { recursive: true });
    for (const [file, trace] of traces) await fs.writeFile(path.join(runDir, "traces", `${file}.json`), JSON.stringify(trace, null, 2), "utf-8");
  }
  await fs.appendFile(
    path.join(runDir, "GAPS.md"),
    `\n- **imported from Harbor**: ${found.length} trial(s) read from ${jobDir}; nothing was generated, checked or judged by agenteval. Each trial's text is the verifier's verdict, not the agent's deliverable (Harbor keeps that in its sandbox); cost is what the agent reported to Harbor.\n`,
    "utf-8",
  );
  if (opts.html) await writeRunReport(runDir);

  return { taskDir, runDir, candidates: [...candidates.keys()], inputs, trials: records.length, chosen: recommendation.chosen, firmness: recommendation.firmness };
}
