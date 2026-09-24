/**
 * The multi-step report: every step's evidence gathered into one page.
 *
 * Each step already has its own report model; this reads them side by side
 * and derives what only a cross-step view shows — the candidate × step
 * matrix, a candidate that is unreliable in several places, a judge
 * favourite the checks disagree with, a judge from the same vendor as a
 * candidate it keeps preferring.
 *
 * Those findings are rules over the numbers, not judgement: each one fires
 * only when its condition is in the data, and says which numbers made it
 * fire. The recommendation per step is still the selector's and nobody
 * else's.
 */

import path from "node:path";
import type { WorkflowRecord } from "./canon/workflow.js";
import { buildStepReport, type CandidateRow, type StepReport } from "./report-model.js";
import { loadBundle } from "./report-v2.js";
import { FIRMNESS_LABEL } from "./report-copy.js";
import { stepsHeadline } from "./report-format.js";
import type { Recommendation } from "./canon/select.js";

/** A step's report, trimmed of what the workflow page never shows (raw outputs, trial rows). */
export type StepDigest = Omit<StepReport, "outputs" | "trials" | "manifest" | "sampleTrial">;

export interface WorkflowStep {
  id: string;
  /** Directory relative to the workflow root. */
  dir: string;
  report: StepDigest | null;
  /** Why the step's report could not be read, when it could not. */
  error: string | null;
}

export interface Finding {
  /** Short tag: the step it is about, or the kind of problem. */
  tag: string;
  title: string;
  body: string;
}

export interface CandidateMeta {
  id: string;
  model: string;
  /** Fixed categorical slot across the whole page. */
  colorIndex: number;
}

export interface AdviceRow {
  step: string;
  chosen: string | null;
  /** Display label, e.g. "directional". */
  firmness: string;
  /** The raw value, for choosing a tone. */
  firmnessKey: Recommendation["firmness"];
  reason: string;
}

export interface WorkflowDigest {
  steps: WorkflowStep[];
  candidates: CandidateMeta[];
  judge: string | null;
  inputsPerStep: number[];
  trialsPer: number | null;
  totalUsd: number;
  headline: string;
  findings: Finding[];
  advice: AdviceRow[];
}

const pct = (n: number, d: number): string => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

function vendorOf(model: string): string | null {
  const i = model.indexOf("/");
  return i > 0 ? model.slice(0, i).toLowerCase() : null;
}

function trim(r: StepReport): StepDigest {
  const { outputs: _o, trials: _t, manifest: _m, sampleTrial: _s, ...rest } = r;
  return rest;
}

async function readStep(root: string, s: { id: string; dir: string }): Promise<WorkflowStep> {
  try {
    const report = buildStepReport(await loadBundle(path.join(root, s.dir)));
    return { id: s.id, dir: s.dir, report: trim(report), error: null };
  } catch (e) {
    return { id: s.id, dir: s.dir, report: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── findings ─────────────────────────────────────────────────────────────────

/** The judge's favourite failed the checks the recommendation passed. */
function judgeVsChecks(steps: readonly WorkflowStep[]): Finding[] {
  return steps.flatMap((s): Finding[] => {
    const r = s.report;
    const fav = r?.verdict.judge;
    if (!r || !fav || !fav.sole || !fav.disagrees) return [];
    const row = r.candidates.find((c) => c.id === fav.candidate);
    if (!row || row.checkExecuted === 0 || row.checkPass === row.checkExecuted) return [];
    const chosen = r.verdict.chosen;
    return [{
      tag: s.id,
      title: `The judge preferred ${fav.candidate} most, but it passed only ${pct(row.checkPass, row.checkExecuted)} of required checks`,
      body: `${fav.candidate} had the highest judge win rate on ${s.id} (${fav.wins} W ${fav.losses} L ${fav.ties} T), `
        + `yet passed ${row.checkPass}/${row.checkExecuted} required checks — the judge was swayed by output that looked good. `
        + (chosen ? `By the checks, this step recommends ${chosen}.` : "No candidate on this step passes every gate."),
    }];
  });
}

/** Candidates that did not complete normally, gathered across steps. */
function unreliable(steps: readonly WorkflowStep[]): Finding[] {
  const byCandidate = new Map<string, Array<{ step: string; row: CandidateRow }>>();
  for (const s of steps) {
    for (const row of s.report?.candidates ?? []) {
      if (row.completed.total > 0 && row.completed.ok < row.completed.total) {
        byCandidate.set(row.id, [...(byCandidate.get(row.id) ?? []), { step: s.id, row }]);
      }
    }
  }
  return [...byCandidate.entries()].map(([candidate, hits]) => {
    const where = hits.map((h) => `${h.step} ${pct(h.row.completed.ok, h.row.completed.total)}`).join(", ");
    const why = [...new Set(hits.flatMap((h) => h.row.states.filter(([st]) => st !== "success").map(([st]) => st)))];
    return {
      tag: "Reliability",
      title: `${candidate} did not complete every time on ${hits.length} step(s)`,
      body: `Completion rate: ${where}. Reasons for not completing: ${why.join(", ")}. Its win rates and scores on these steps are computed on a shrunken sample.`,
    };
  });
}

/** A judge from the same vendor as a candidate it keeps preferring. */
function sameVendor(steps: readonly WorkflowStep[], judge: string | null, candidates: readonly CandidateMeta[]): Finding[] {
  const jv = judge ? vendorOf(judge) : null;
  if (!jv) return [];
  return candidates.flatMap((c): Finding[] => {
    if (vendorOf(c.model) !== jv) return [];
    const favoured = steps
      .filter((s) => s.report?.verdict.judge?.sole && s.report.verdict.judge.candidate === c.id)
      .map((s) => s.id);
    if (favoured.length === 0) return [];
    return [{
      tag: "Bias",
      title: `${c.id} and the judge are both from ${jv}`,
      body: `The judge is ${judge}, ${c.id} (${c.model}) is also from ${jv}, and it is the judge's favourite on ${favoured.join(", ")} — `
        + "this may be same-vendor preference. Re-judge these steps with a judge from another vendor.",
    }];
  });
}

/** Every step rests on too few inputs to be more than a direction. */
function thinSample(steps: readonly WorkflowStep[]): Finding[] {
  const thin = steps.filter((s) => s.report?.verdict.firmness === "directional");
  if (thin.length === 0) return [];
  const inputs = thin.map((s) => s.report!.plan.inputs);
  const few = Math.max(...inputs);
  return [{
    tag: "Sample",
    title: thin.length === steps.length ? "Every step's result is directional only" : `${thin.length} step(s) have directional results only`,
    body: `${thin.map((s) => s.id).join(", ")}: at most ${few} input(s) per step, fewer than the 10 a decision needs, or the spec declares no minimum meaningful difference. `
      + "Add inputs and declare a minimum meaningful difference before a result can become firm.",
  }];
}

/** Every cross-step finding, in the order the page shows them. */
export function workflowFindings(
  steps: readonly WorkflowStep[],
  judge: string | null,
  candidates: readonly CandidateMeta[],
): Finding[] {
  return [...judgeVsChecks(steps), ...unreliable(steps), ...sameVendor(steps, judge, candidates), ...thinSample(steps)];
}

// ── headline ─────────────────────────────────────────────────────────────────

function headlineOf(steps: readonly WorkflowStep[]): string {
  const read = steps.filter((s) => s.report).map((s) => ({ chosen: s.report!.verdict.chosen }));
  return stepsHeadline(read, steps.length - read.length);
}

// ── assemble ─────────────────────────────────────────────────────────────────

export async function buildWorkflowDigest(root: string, record: WorkflowRecord): Promise<WorkflowDigest> {
  const steps = await Promise.all(record.steps.map((s) => readStep(root, s)));

  // Colour follows a candidate across the whole page, by first appearance.
  const seen = new Map<string, string>();
  for (const s of steps) for (const c of s.report?.candidates ?? []) if (!seen.has(c.id)) seen.set(c.id, c.model);
  const candidates = [...seen.entries()].map(([id, model], i) => ({ id, model, colorIndex: i }));

  const firstReport = steps.find((s) => s.report)?.report ?? null;
  const judge = firstReport?.facts.find((f) => f.label === "Judge")?.value.split(" · ")[0] ?? null;

  return {
    steps,
    candidates,
    judge,
    inputsPerStep: steps.map((s) => s.report?.plan.inputs ?? 0),
    trialsPer: firstReport?.plan.trialsPer ?? null,
    totalUsd: record.ledger.total,
    headline: headlineOf(steps),
    findings: workflowFindings(steps, judge, candidates),
    advice: steps.flatMap((s) =>
      s.report
        ? [{
            step: s.id,
            chosen: s.report.verdict.chosen,
            firmness: FIRMNESS_LABEL[s.report.verdict.firmness],
            firmnessKey: s.report.verdict.firmness,
            reason: s.report.verdict.text,
          }]
        : [],
    ),
  };
}
