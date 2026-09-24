/**
 * What a report says, separated from how it looks.
 *
 * Two renderers present a run: `report.html` (string templates, written next
 * to the run, opens offline) and the dashboard's React report page (which can
 * export itself to HTML). They must never disagree — not on a number, and not
 * on the wording that carries a decision: "no eligible candidate" rather than
 * a blank, a gated candidate named with its reason, a judge preference shown
 * beside the recommendation and never inside it. So every derived number and
 * every decided sentence is computed here, once, and both renderers read it.
 *
 * Pure: takes rows already read from disk, returns plain JSON-safe data.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { modelRefOf } from "./adapters/types.js";
import type { CostLedger } from "./canon/cost.js";
import type { EvaluationRow, TrialRow } from "./canon/rows.js";
import type { CanonSummary } from "./canon/write.js";
import type { Recommendation } from "./canon/select.js";
import type { E2eValidation } from "./canon/e2e.js";
import { judgeStandings } from "./canon/judge-standings.js";
import { judgeDiscrimination } from "./canon/discrimination.js";
import { dimensionKeys, profiles, type CandidateProfile } from "./report-charts.js";
import type { RawOutput } from "./report-evidence.js";
import type { RunBundle } from "./report-v2.js";
import type { WorkflowRecord } from "./canon/workflow.js";
import { planFromRun, type PlanStep } from "./test-plan.js";
import type { WorkflowDigest } from "./workflow-report-model.js";
import { NO_PICK, plural, sha8 } from "./report-format.js";
import {
  FIRMNESS_LABEL, firmnessNote, gateRows, judgeNote, modeLabel, recommendationSentence, type GateRow,
} from "./report-copy.js";

export { fmtPct, fmtScore, fmtSec, fmtUsd, sha8, stateTone } from "./report-format.js";

// ── candidates ─────────────────────────────────────────────────────────────

export interface CandidateView {
  id: string;
  model: string;
  deployment: string;
  attempts: number;
  checkPass: number;
  checkExecuted: number;
  winRate: number | null;
  comparisons: number;
  absolute: number | null;
  costPerSuccess: number | null;
  p50: number | null;
  states: Array<[string, number]>;
  outcomes: { success: number; failure: number; undetermined: number };
  /** Pairwise wins, losses, ties, from the rows the win rate is computed on. */
  record: { wins: number; losses: number; ties: number };
  /** Attempts that completed normally, of all attempts. */
  completed: { ok: number; total: number };
}

/**
 * A candidate's pairwise record, counted from the same evaluation rows the
 * win rate is: wins, losses and ties, where a tie is a duel whose two orders
 * disagreed. `rate` counts a tie as half, so 3–0–3 is always 75%.
 */
export function duelRecord(
  candidate: string,
  rows: readonly EvaluationRow[],
): { wins: number; losses: number; ties: number; comparisons: number; rate: number | null } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const r of rows) {
    if (r.evaluator !== "pairwise-swap" || r.state !== "pass" || r.subject.kind !== "pair") continue;
    const { a, b } = r.subject;
    if (a !== candidate && b !== candidate) continue;
    const side = a === candidate ? "a" : "b";
    if (r.overall === side) wins += 1;
    else if (r.overall === "tie") ties += 1;
    else losses += 1;
  }
  const comparisons = wins + losses + ties;
  return { wins, losses, ties, comparisons, rate: comparisons > 0 ? ((wins + ties / 2) / comparisons) * 100 : null };
}

export function winRate(candidate: string, rows: readonly EvaluationRow[]): { rate: number | null; comparisons: number } {
  const r = duelRecord(candidate, rows);
  return { rate: r.rate, comparisons: r.comparisons };
}

export function candidateViews(b: RunBundle): CandidateView[] {
  return b.summary.candidates.map((c) => {
    const own = b.trials.filter((t) => t.candidate === c.candidate);
    const def = b.manifest.candidates[c.candidate];
    const deployments = [...new Set(own.map((t) => t.deployment_ref).filter((d): d is string => d !== null))];
    const abs = own.map((t) => t.judge.absolute_overall).filter((v): v is number => v !== null);
    const duel = duelRecord(c.candidate, b.evaluations);
    const attempts = Object.values(c.completion_states).reduce((n, k) => n + k, 0);
    return {
      id: c.candidate,
      model: def ? modelRefOf(def) : c.candidate,
      deployment: deployments.join(", ") || "—",
      attempts: c.valid_attempts,
      checkPass: c.check_states.pass,
      checkExecuted: c.check_states.pass + c.check_states.fail,
      winRate: duel.rate,
      comparisons: duel.comparisons,
      absolute: abs.length ? abs.reduce((s, v) => s + v, 0) / abs.length : null,
      costPerSuccess: c.generation_cost_per_success,
      p50: c.p50_ms,
      states: Object.entries(c.completion_states).filter(([, n]) => n > 0),
      outcomes: c.outcomes,
      record: { wins: duel.wins, losses: duel.losses, ties: duel.ties },
      completed: { ok: c.completion_states.success ?? 0, total: attempts },
    };
  });
}

// ── the verdict's wording ─────────────────────────────────────────────────

/** The plain-language recommendation, one paragraph. */
export function verdictText(b: RunBundle): string {
  return recommendationSentence(b.recommendation);
}

/** Why the recommendation is as firm as it is. */
export function subtitleReasons(rec: Recommendation, directionality: { reasons: string[] }): string[] {
  return rec.firmness === "directional" ? directionality.reasons : rec.reasons;
}

export interface JudgeFavourite {
  candidate: string;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  /** Strictly ahead of every other candidate; false when the top is shared. */
  sole: boolean;
  /** The judge preferred someone other than the recommendation. */
  disagrees: boolean;
}

/**
 * The judge's top pick by win rate, or null when nothing was compared — or
 * when nobody led. A favourite picked out of a tie is an artefact of sort
 * order, and naming it would put a preference in the judge's mouth.
 */
export function judgeFavourite(b: RunBundle): JudgeFavourite | null {
  const ranked = [...judgeStandings(b.trials)]
    .filter((s) => s.comparisons > 0)
    .sort((a, z) => (z.win_rate ?? -1) - (a.win_rate ?? -1));
  const [best, second] = ranked;
  if (!best) return null;
  const chosen = b.recommendation.chosen;
  return {
    candidate: best.candidate,
    wins: best.wins,
    losses: best.losses,
    ties: best.ties,
    comparisons: best.comparisons,
    sole: !second || (second.win_rate ?? -1) < (best.win_rate ?? -1),
    disagrees: chosen !== null && best.candidate !== chosen,
  };
}

/** Headline facts under the recommendation: cost, check pass rate, firmness. */
export function verdictFacts(rec: Recommendation, chosenView: CandidateView | undefined): string[] {
  if (!rec.chosen || !chosenView) return [];
  return [
    chosenView.costPerSuccess !== null ? `$${chosenView.costPerSuccess.toFixed(4)} per success` : null,
    chosenView.checkExecuted > 0 ? `required check ${chosenView.checkPass}/${chosenView.checkExecuted} passed` : null,
  ].filter((x): x is string => x !== null);
}

export function evaluatorErrorSubject(e: EvaluationRow): string {
  return e.subject.kind === "pair"
    ? `${e.subject.a} vs ${e.subject.b} · ${e.subject.input}`
    : `${e.subject.candidate} · ${e.subject.input} · t${e.subject.trial}`;
}

/** The ratio of evaluation spend to generation spend, stated when it exists. */
export function ledgerNote(led: CostLedger): string {
  const ratio =
    led.generation > 0
      ? `Evaluation spend is ${((led.judging + led.scoring + led.retries) / led.generation).toFixed(1)}× generation spend. `
      : "";
  const undefinedCps = led.cost_per_success === null ? "No task succeeded, so cost per success is undefined." : "";
  return (ratio + undefinedCps).trim();
}

// ── dimension preference ──────────────────────────────────────────────────

export interface PreferenceTable {
  dims: string[];
  /** Sorted by overall preference, best first. `null` means that pair never met on that dimension. */
  rows: Array<{ candidate: string; cells: Array<number | null> }>;
}

/**
 * Per-dimension pairwise win rate, 0–100, tie counts 0.5. A 50 means
 * "indistinguishable", not "no data" — an empty cell is what no data looks
 * like. Judge opinion, shown next to the recommendation, never inside it.
 */
export function dimensionPreference(evaluations: readonly EvaluationRow[]): PreferenceTable | null {
  const duels = evaluations.filter((e) => e.subject.kind === "pair" && e.state === "pass" && e.dimensions);
  if (duels.length === 0) return null;

  const dims = [...new Set(duels.flatMap((d) => Object.keys(d.dimensions ?? {})))];
  const tally = new Map<string, Map<string, { points: number; duels: number }>>();
  const bump = (candidate: string, dim: string, points: number): void => {
    const row = tally.get(candidate) ?? new Map<string, { points: number; duels: number }>();
    const cell = row.get(dim) ?? { points: 0, duels: 0 };
    row.set(dim, { points: cell.points + points, duels: cell.duels + 1 });
    tally.set(candidate, row);
  };

  for (const duel of duels) {
    if (duel.subject.kind !== "pair") continue;
    const { a, b } = duel.subject;
    for (const [dim, winner] of Object.entries(duel.dimensions ?? {})) {
      if (winner !== "a" && winner !== "b" && winner !== "tie") continue;
      bump(a, dim, winner === "a" ? 1 : winner === "tie" ? 0.5 : 0);
      bump(b, dim, winner === "b" ? 1 : winner === "tie" ? 0.5 : 0);
    }
  }

  const rate = (candidate: string, dim: string): number | null => {
    const cell = tally.get(candidate)?.get(dim);
    return cell && cell.duels > 0 ? (cell.points / cell.duels) * 100 : null;
  };
  const overall = (candidate: string): number => {
    const cells = [...(tally.get(candidate)?.values() ?? [])];
    const duelCount = cells.reduce((s, c) => s + c.duels, 0);
    return duelCount === 0 ? -1 : (cells.reduce((s, c) => s + c.points, 0) / duelCount) * 100;
  };

  const rows = [...tally.keys()]
    .sort((x, y) => overall(y) - overall(x))
    .map((candidate) => ({ candidate, cells: dims.map((d) => rate(candidate, d)) }));
  return { dims, rows };
}

// ── GAPS.md ────────────────────────────────────────────────────────────────

export interface GapLine {
  kind: "item" | "heading";
  text: string;
}

/** Bullet items, and — for the workflow page — `##` section headings. */
export function gapLines(gaps: string, withHeadings: boolean): GapLine[] {
  return gaps.split("\n").flatMap((l): GapLine[] => {
    if (l.startsWith("- ")) return [{ kind: "item", text: l.slice(2) }];
    if (withHeadings && l.startsWith("## ")) return [{ kind: "heading", text: l.slice(3) }];
    return [];
  });
}

// ── the step report, as data ──────────────────────────────────────────────

export interface CandidateRow extends CandidateView {
  isControl: boolean;
  gated: boolean;
  chosen: boolean;
  /** Fixed categorical slot, by first appearance — colour follows the candidate. */
  colorIndex: number;
}

export interface StepReport {
  kind: "step";
  dirName: string;
  protocol: string;
  stepId: string;
  runName: string;
  /** `YYYY-MM-DD HH:MM`, when the run started. */
  startedAt: string;
  plan: { candidates: number; inputs: number; trialsPer: number; trials: number };
  /** What this run tested, from its frozen manifest. */
  tested: PlanStep;
  facts: Array<{ label: string; value: string }>;
  verdict: {
    firmness: Recommendation["firmness"];
    firmnessLabel: string;
    /** Why it is as firm as it is. */
    firmnessNote: string;
    inputs: number;
    chosen: string | null;
    operatingMode: string | null;
    modeLabel: string;
    facts: string[];
    /** What is recommended and why, or why nothing is. */
    text: string;
    judge: JudgeFavourite | null;
    judgeNote: string;
    /** The chosen candidate's headline numbers; null when nobody was chosen. */
    headline: { costPerSuccess: number | null; checkPass: number; checkExecuted: number } | null;
    /** Everything this evaluation spent, all-in. */
    spend: number;
  };
  gates: GateRow[];
  filters: Recommendation["filters"];
  eligible: string[];
  candidates: CandidateRow[];
  trialsPer: number;
  control: string | null;
  coverage: CanonSummary["evaluation_coverage"];
  evaluatorErrors: Array<{ evaluator: string; subject: string; reason: string }>;
  ledger: CostLedger;
  ledgerNote: string;
  trialCount: number;
  absoluteRan: boolean;
  /** Dimensions where the absolute scorer gave every candidate the same score. */
  saturated: string[];
  dims: string[];
  profiles: CandidateProfile[];
  preference: PreferenceTable | null;
  duels: EvaluationRow[];
  trials: TrialRow[];
  outputs: RawOutput[];
  gaps: GapLine[];
  sampleTrial: string;
  manifest: string;
}

export function buildStepReport(b: RunBundle): StepReport {
  const m = b.manifest;
  const rec = b.recommendation;
  const views = candidateViews(b);
  const inputs = Object.keys(m.test_set.inputs ?? {}).length;
  const support = subtitleReasons(rec, b.summary.directionality);
  const chosenView = views.find((v) => v.id === rec.chosen);
  const judge = judgeFavourite(b);

  return {
    kind: "step",
    dirName: path.basename(b.dir),
    protocol: m.protocol_version,
    stepId: m.step.id,
    runName: m.run_name,
    startedAt: m.started_at.slice(0, 16).replace("T", " "),
    plan: { candidates: views.length, inputs, trialsPer: m.execution.trials_per_case, trials: b.trials.length },
    tested: planFromRun(b),
    facts: [
      { label: "Spec", value: `${m.spec.path ?? "—"} · sha256 ${sha8(m.spec.sha256)}` },
      { label: "Test set", value: `${m.test_set.id ?? "—"} · ${inputs} input(s)` },
      { label: "Trial plan", value: `${plural(views.length, "candidate")} × ${plural(inputs, "input")} × ${plural(m.execution.trials_per_case, "trial")} = ${b.trials.length}` },
      { label: "Judge", value: `${m.judge.model} · rubric ${sha8(m.evaluators.rubric_sha256)}` },
      { label: "Mode", value: `${m.execution.benchmark_mode} · ${m.execution.cache_mode} cache` },
      { label: "Run time", value: `${m.started_at.slice(0, 16).replace("T", " ")} → ${(m.finished_at ?? "").slice(11, 16)}` },
      { label: "Operating mode", value: `${modeLabel(m.operating_mode)} · ${FIRMNESS_LABEL[rec.firmness]}${rec.chosen ? ` · recommend ${rec.chosen}` : ` · ${NO_PICK}`}` },
      { label: "Selection rule", value: rec.rule_version },
      { label: "harness", value: `${m.harness.version} · ${m.harness.git_sha ?? "—"}` },
    ],
    verdict: {
      firmness: rec.firmness,
      firmnessLabel: FIRMNESS_LABEL[rec.firmness],
      firmnessNote: firmnessNote(rec.firmness, support),
      inputs,
      chosen: rec.chosen,
      operatingMode: rec.operating_mode,
      modeLabel: modeLabel(rec.operating_mode),
      facts: verdictFacts(rec, chosenView),
      text: verdictText(b),
      judge,
      judgeNote: judgeNote(judge, rec.chosen),
      headline: chosenView
        ? { costPerSuccess: chosenView.costPerSuccess, checkPass: chosenView.checkPass, checkExecuted: chosenView.checkExecuted }
        : null,
      spend: b.ledger.total,
    },
    gates: gateRows(rec),
    filters: rec.filters,
    eligible: rec.eligible,
    candidates: views.map((v, i) => ({
      ...v,
      isControl: m.control_candidate === v.id,
      gated: !rec.eligible.includes(v.id),
      chosen: rec.chosen === v.id,
      colorIndex: i % 4,
    })),
    trialsPer: m.execution.trials_per_case,
    control: m.control_candidate ?? null,
    coverage: b.summary.evaluation_coverage,
    evaluatorErrors: b.evaluations
      .filter((e) => e.state === "evaluator_error")
      .map((e) => ({ evaluator: e.evaluator, subject: evaluatorErrorSubject(e), reason: e.reason ?? "" })),
    ledger: b.ledger,
    ledgerNote: ledgerNote(b.ledger),
    trialCount: b.trials.length,
    absoluteRan: b.trials.some((t) => t.judge.absolute_overall !== null),
    saturated: judgeDiscrimination(b.trials).saturated,
    dims: dimensionKeys(b.trials),
    profiles: profiles(b.trials),
    preference: dimensionPreference(b.evaluations),
    duels: b.evaluations.filter((r) => r.subject.kind === "pair"),
    trials: b.trials,
    outputs: b.outputs,
    gaps: gapLines(b.gaps, false),
    sampleTrial: b.trials[0] ? JSON.stringify(b.trials[0], null, 1) : "{}",
    manifest: JSON.stringify(m, null, 1),
  };
}

// ── the workflow report, as data ──────────────────────────────────────────

/** adopt-combination reads as firm; not-validated is the one that needs a person. */
export function workflowVerdictTone(v: E2eValidation | null): "firm" | "needs-review" | "" {
  if (v === null) return "";
  if (v.verdict === "adopt-combination") return "firm";
  if (v.verdict === "not-validated") return "needs-review";
  return "";
}

export function workflowVerdictLine(v: E2eValidation): string {
  if (v.verdict === "adopt-combination") return "The proposed combination passed end-to-end validation and can be adopted.";
  if (v.verdict === "keep-control") return "The proposed combination did not beat the single-model control by the declared minimum meaningful difference, so the control is kept.";
  return "This run is not enough to conclude on the combination.";
}

/** Said when there is no §8 verdict, which depends on whether steps were chained. */
export function workflowNoVerdictLine(handoff: boolean): string {
  return handoff
    ? "The chain ran end to end, but no validation verdict was written."
    : "The steps are independent (no input_from): no workflow was assembled and no end-to-end comparison was made.";
}

export interface WorkflowReport {
  kind: "workflow";
  record: WorkflowRecord;
  verdictLine: string;
  tone: "firm" | "needs-review" | "";
  gaps: GapLine[];
  /** Every step's report side by side; null when the steps were not read. */
  digest: WorkflowDigest | null;
}

export function buildWorkflowReport(record: WorkflowRecord, gaps: string, digest: WorkflowDigest | null = null): WorkflowReport {
  const v = record.e2e_validation ?? null;
  return {
    kind: "workflow",
    record,
    verdictLine: v ? workflowVerdictLine(v) : workflowNoVerdictLine(record.handoff),
    tone: workflowVerdictTone(v),
    gaps: gapLines(gaps, true),
    digest,
  };
}

export type ReportModel = StepReport | WorkflowReport;

/** Read whichever report a directory holds: a workflow root, or one step. */
export async function loadReportModel(dir: string): Promise<ReportModel> {
  // Imported here rather than at the top: report-v2 and report-workflow both
  // import this module for their wording, and a static cycle would leave one
  // of them half-initialised.
  const { isWorkflowRun, loadWorkflowRecord, workflowGapsFor } = await import("./report-workflow.js");
  if (await isWorkflowRun(dir)) {
    const record = await loadWorkflowRecord(dir);
    const { buildWorkflowDigest } = await import("./workflow-report-model.js");
    return buildWorkflowReport(record, await workflowGapsFor(dir, record), await buildWorkflowDigest(dir, record));
  }
  const { loadBundle } = await import("./report-v2.js");
  return buildStepReport(await loadBundle(dir));
}

/** True when `dir` holds something a report can be built from. */
export async function hasReport(dir: string): Promise<boolean> {
  const exists = (name: string) => fs.access(path.join(dir, name)).then(() => true, () => false);
  return (await exists("workflow.json")) || ((await exists("manifest.json")) && (await exists("summary.json")));
}
