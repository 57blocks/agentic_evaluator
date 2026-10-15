/**
 * Judge a finished run again (`agenteval judge`): pairwise, with each step's
 * current judge config, on the files every trial left — generating nothing.
 *
 * A step that ran without a judge, or with the wrong one, need not be paid
 * for twice. Every trial's files are kept under its run (checks/<trial>/);
 * for a combined run, combined-from.json says which run that was. The judge
 * reads them through the step's `show`, and on a step with fixtures only the
 * files the candidate added or changed: a project's untouched starting code
 * says nothing about who did the task better. The step's pair verdicts are
 * replaced, and its rates, recommendation, ledger and report follow.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { renderArtifacts } from "../adapters/deliverable.js";
import type { ArtifactFile } from "../adapters/types.js";
import { buildLedger } from "../canon/cost.js";
import { judgeDiscrimination } from "../canon/discrimination.js";
import { short } from "../canon/hash.js";
import type { RunManifest } from "../canon/manifest.js";
import { directionality, ratesFor } from "../canon/rates.js";
import type { DimensionDetail, EvaluationRow, TrialRow } from "../canon/rows.js";
import { matchesShow } from "../canon/show.js";
import { evaluationCoverage, writeCanonBundle, type CanonSummary } from "../canon/write.js";
import { judgePair, judgePromptTemplateSha, PAIRWISE_EVALUATOR_ID, type JudgedPair } from "../judge.js";
import { resolveTaskAsset } from "../paths.js";
import { writeRunReport } from "../report-v2.js";
import { ABSOLUTE_EVALUATOR_ID } from "../score.js";
import { loadWorkflow } from "../spec/load-spec.js";
import { writeWorkflowFromSteps } from "./combine.js";
import { fixturePath } from "./fixture.js";
import { applyExitPolicy } from "./exit-policy.js";
import { AGENT_LOG, mapWithConcurrency, safeName } from "./generate.js";
import { runsRootFor } from "./workspace.js";
import { sha256 } from "../canon/hash.js";

/** Files a trial dir holds that the candidate did not write. */
const NOT_THE_ANSWER = new Set([AGENT_LOG, "output.txt", "input.txt", "meta.json", ".eval-input.txt", ".eval-usage.json", "EVIDENCE_INCOMPLETE.txt", "node_modules", ".git"]);

async function filesIn(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.split("/").some((part) => NOT_THE_ANSWER.has(part)) || /^\.vitest/.test(e.name)) continue;
    out.set(rel, await fs.readFile(abs));
  }
  return out;
}

/** What the judge reads of one trial: shown files, minus those the fixture already had unchanged. */
export async function answerText(trialDir: string, show: readonly string[] | undefined, fixture: string | null): Promise<string> {
  const files = await filesIn(trialDir);
  const start = fixture ? await filesIn(fixture) : new Map<string, Buffer>();
  const kept: ArtifactFile[] = [];
  for (const [rel, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (show && show.length > 0 && !matchesShow(rel, show)) continue;
    const before = start.get(rel);
    if (before && before.equals(bytes)) continue;
    if (bytes.subarray(0, 8192).includes(0)) continue;
    kept.push({ path: rel, content: bytes.toString("utf-8") });
  }
  return renderArtifacts(kept);
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await fs.readFile(file, "utf-8").catch(() => "");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
}

/** Where a trial's files were kept: under the run that produced it. */
async function trialDirFor(runsRoot: string, stepDir: string, step: string, t: TrialRow, provenance: Map<string, string>): Promise<string | null> {
  const name = `${safeName(t.candidate)}__${t.input}__t${t.trial}`;
  const from = provenance.get(`${t.candidate} · ${t.input} · ${t.trial}`);
  const roots = from ? [path.join(runsRoot, from, safeName(step)), path.join(runsRoot, from)] : [stepDir];
  for (const r of roots) {
    const d = path.join(r, "checks", name);
    if (await fs.stat(d).then((s) => s.isDirectory(), () => false)) return d;
  }
  return null;
}

export interface JudgeRunResult {
  steps: Array<{ id: string; pairs: number; failed: number; costUsd: number; chosen: string | null }>;
}

export async function judgeRun(
  specPath: string,
  runId: string,
  opts: { steps?: string[]; html?: boolean; concurrency?: number; judge?: typeof judgePair } = {},
): Promise<JudgeRunResult> {
  const judge = opts.judge ?? judgePair;
  const suites = await loadWorkflow(specPath);
  const runsRoot = runsRootFor(suites[0]!.taskRoot);
  const root = path.join(runsRoot, path.basename(runId));
  if (!(await fs.stat(root).then((s) => s.isDirectory(), () => false))) throw new Error(`no run ${runId} under ${runsRoot}`);
  const nested = await fs.stat(path.join(root, "workflow.json")).then(() => true, () => false);
  const wanted = suites.filter((s) => (opts.steps ? opts.steps.includes(s.step) : (s.judgeMethods ?? []).includes("pairwise-swap")));
  const unknown = (opts.steps ?? []).filter((id) => !suites.some((s) => s.step === id));
  if (unknown.length > 0) throw new Error(`no step ${unknown.join(", ")} in ${specPath}`);
  const result: JudgeRunResult = { steps: [] };

  for (const suite of wanted) {
    const stepDir = nested ? path.join(root, safeName(suite.step)) : root;
    const manifest = JSON.parse(await fs.readFile(path.join(stepDir, "manifest.json"), "utf-8")) as RunManifest;
    // Under the spec's current exit-code policy (cli.exit_code), recorded runs included.
    const trials = applyExitPolicy(await readJsonl<TrialRow>(path.join(stepDir, "scores.jsonl")), suite);
    const kept = (await readJsonl<EvaluationRow>(path.join(stepDir, "evaluations.jsonl"))).filter((e) => e.evaluator !== PAIRWISE_EVALUATOR_ID);
    const provenance = new Map<string, string>(
      (await fs.readFile(path.join(stepDir, "combined-from.json"), "utf-8").then((t) => JSON.parse(t) as { trials: { trial: string; from: string }[] }, () => ({ trials: [] }))).trials.map((x) => [x.trial, x.from]),
    );
    const rubricFile = suite.rubricFile;
    const rubric = await fs.readFile(await resolveTaskAsset(suite.taskRoot, rubricFile), "utf-8");
    const dims = suite.dimensions ?? [];
    const version = `${suite.judge}+rubric-${short(sha256(rubric))}+tpl-${short(judgePromptTemplateSha(rubric, dims))}`;

    // One output per (candidate, input): the first trial that completed, as a run's judging does.
    const answers = new Map<string, Map<string, string>>();
    for (const t of trials) {
      if (t.completion_state !== "success") continue;
      const byCandidate = answers.get(t.input) ?? new Map<string, string>();
      answers.set(t.input, byCandidate);
      if (byCandidate.has(t.candidate)) continue;
      const dir = await trialDirFor(runsRoot, stepDir, suite.step, t, provenance);
      if (!dir) continue;
      const text = await answerText(dir, suite.judgeShow, fixturePath(suite, t.input));
      if (text.trim() !== "") byCandidate.set(t.candidate, text);
    }
    const pairs: Array<{ input: string; a: string; b: string }> = [];
    for (const input of suite.inputs) {
      const present = suite.candidates.filter((c) => answers.get(input)?.has(c));
      for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) pairs.push({ input, a: present[i]!, b: present[j]! });
    }

    const judged = await mapWithConcurrency(pairs, opts.concurrency ?? 4, async (p): Promise<{ p: typeof p; j: JudgedPair | null; error?: string }> => {
      try {
        const j = await judge({
          judgeModel: suite.judge,
          rubric,
          dimensions: dims,
          inputSlug: p.input,
          a: p.a,
          aText: answers.get(p.input)!.get(p.a)!,
          b: p.b,
          bText: answers.get(p.input)!.get(p.b)!,
          timeoutMs: 240_000,
          traceContext: { phase: "judge-run", step: suite.step },
        });
        return { p, j };
      } catch (err) {
        return { p, j: null, error: err instanceof Error ? err.message : String(err) };
      }
    });

    const run = manifest.run_id;
    const pairRows: EvaluationRow[] = judged.map(({ p, j, error }) => {
      if (!j) return { run, step: suite.step, evaluator: PAIRWISE_EVALUATOR_ID, version, state: "evaluator_error", subject: { kind: "pair", a: p.a, b: p.b, input: p.input }, reason: error ?? "judge failed" };
      const dimensions: Record<string, "a" | "b" | "tie"> = {};
      const detail: Record<string, DimensionDetail> = {};
      for (const [k, v] of Object.entries(j.dimensions)) {
        dimensions[k] = v.resolved;
        detail[k] = { forward: v.forward, reverse: v.reverse, resolved: v.resolved, ...(v.reason ? { reason: v.reason } : {}) };
      }
      return {
        run,
        step: suite.step,
        evaluator: PAIRWISE_EVALUATOR_ID,
        version,
        state: "pass",
        subject: { kind: "pair", a: p.a, b: p.b, input: p.input },
        dimensions,
        dimension_detail: detail,
        overall: j.overall.resolved,
        evidence: j.overall.reason,
        cost: { usd: j.usage.costUsd, retry_usd: j.usage.retryCostUsd, source: j.usage.costSource, calls: j.usage.calls },
        ms: j.usage.ms,
      };
    });

    // Each judged output carries its record against the others.
    const firstOk = new Map<string, number>();
    for (const t of trials) if (t.completion_state === "success" && !firstOk.has(`${t.candidate}|${t.input}`)) firstOk.set(`${t.candidate}|${t.input}`, t.trial);
    const newTrials = trials.map((t) => {
      if (firstOk.get(`${t.candidate}|${t.input}`) !== t.trial) return { ...t, judge: { ...t.judge, pairwise: null } };
      const mine = judged.filter(({ p, j }) => j && p.input === t.input && (p.a === t.candidate || p.b === t.candidate));
      const pairwise = mine.map(({ p, j }) => {
        const side = p.a === t.candidate ? "a" : "b";
        const resolved: "win" | "loss" | "tie" = j!.overall.resolved === "tie" ? "tie" : j!.overall.resolved === side ? "win" : "loss";
        return { vs: p.a === t.candidate ? p.b : p.a, resolved };
      });
      return { ...t, judge: { ...t.judge, pairwise: pairwise.length > 0 ? pairwise : null } };
    });
    const evaluations = [...kept, ...pairRows];
    const candidates = suite.candidates.filter((c) => newTrials.some((t) => t.candidate === c));
    const previous = await fs.readFile(path.join(stepDir, "summary.json"), "utf-8").then((t) => JSON.parse(t) as CanonSummary, () => null);
    const summary: CanonSummary = {
      ...(previous ?? ({} as CanonSummary)),
      run,
      step: suite.step,
      inputs: suite.inputs,
      candidates: candidates.map((c) => ratesFor(c, newTrials)),
      directionality: directionality(suite.inputs.length, suite.mmd),
      judge_discrimination: judgeDiscrimination(newTrials),
      evaluation_coverage: evaluationCoverage(evaluations),
    };
    const methods = [...new Set([...(manifest.judge.methods ?? []), "pairwise-swap"])];
    const newManifest: RunManifest = {
      ...manifest,
      judge: { ...manifest.judge, model: suite.judge, methods },
      evaluators: { ...manifest.evaluators, rubric_sha256: sha256(rubric), judge_template_sha256: judgePromptTemplateSha(rubric, dims) },
    };
    const ledger = buildLedger(newTrials, evaluations, PAIRWISE_EVALUATOR_ID, ABSOLUTE_EVALUATOR_ID);
    const combinedNote = await fs.readFile(path.join(stepDir, "GAPS.md"), "utf-8").then((g) => g.split("\n").filter((l) => l.startsWith("- **combined run**")), () => []);
    const recommendation = await writeCanonBundle(stepDir, { manifest: newManifest, trials: newTrials, evaluations, ledger, summary });
    const failed = pairRows.filter((r) => r.state !== "pass").length;
    const costUsd = pairRows.reduce((n, r) => n + (r.cost?.usd ?? 0) + (r.cost?.retry_usd ?? 0), 0);
    await fs.appendFile(
      path.join(stepDir, "GAPS.md"),
      [
        "",
        ...combinedNote,
        `- **judged after the run**: \`agenteval judge\` compared ${pairs.length} pair(s) with ${suite.judge} on the files each trial left${suite.fixtureDir ? ", minus those unchanged from the fixture" : ""}; ${failed} judge call(s) failed.`,
        "",
      ].join("\n"),
      "utf-8",
    );
    if (opts.html) await writeRunReport(stepDir);
    result.steps.push({ id: suite.step, pairs: pairs.length, failed, costUsd, chosen: recommendation.chosen });
  }

  if (nested && result.steps.length > 0) {
    const record = JSON.parse(await fs.readFile(path.join(root, "workflow.json"), "utf-8")) as { run_name?: string; run_id?: string };
    await writeWorkflowFromSteps(root, suites, record.run_id ?? path.basename(root), record.run_name ?? suites[0]!.runName ?? "", opts.html === true);
  }
  return result;
}

