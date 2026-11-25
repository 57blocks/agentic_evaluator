/**
 * The noisiest false alarms of a code review: on clean items, the findings
 * the matcher counted as claiming a defect, and which items drew the most.
 *
 * Read from what the check already leaves per trial, findings-match.json
 * (its decision record: the findings and, for a clean item, each one's
 * basis), so a run needs no regrade to show them. A trial whose record is
 * missing or unreadable contributes nothing; the `defect_claims` measure
 * stays the count of record.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { TrialRow } from "../canon/rows.js";
import { escapeHtml } from "../html.js";
import { DECISIONS_FILE } from "./findings-match.js";
import type { ClaimBasis } from "./match.js";
import { FINDINGS_MATCH_REVISION } from "./version.js";

/** Characters of a comment shown; the whole of it is in the trial's findings.json. */
const MESSAGE_CHARS = 600;
/** The bases a clean item's finding counts as a claim on (match.ts isClaim). */
const CLAIM_BASES: ReadonlySet<string> = new Set<ClaimBasis>(["blocking", "llm-claim", "unclassified"]);
const KIND_PREFIX = FINDINGS_MATCH_REVISION.replace(/-\d+$/, "-");

export interface RecordedClaim {
  where: string;
  message: string;
  basis: ClaimBasis;
}

export interface DefectClaim extends RecordedClaim {
  candidate: string;
  input: string;
  trial: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function whereOf(f: Record<string, unknown>): string {
  if (typeof f.file !== "string") return "PR-level";
  if (typeof f.start_line !== "number") return f.file;
  return `${f.file}:${f.start_line}${typeof f.end_line === "number" && f.end_line !== f.start_line ? `-${f.end_line}` : ""}`;
}

/** The claims in one decision record; none unless it is a clean item's, well formed. */
export function claimsOfRecord(record: unknown): RecordedClaim[] {
  if (!isRecord(record) || record.kind !== "clean" || !Array.isArray(record.findings) || !Array.isArray(record.bases)) return [];
  const bases = record.bases;
  return record.findings.flatMap((f, i): RecordedClaim[] => {
    const basis = bases[i];
    if (!isRecord(f) || typeof f.message !== "string" || typeof basis !== "string" || !CLAIM_BASES.has(basis)) return [];
    return [{ where: whereOf(f), message: f.message, basis: basis as ClaimBasis }];
  });
}

/** As run.ts names a trial's directories: a candidate id may hold `/` and `:`. */
const safeName = (candidate: string): string => candidate.replace(/[/:]/g, "_");

/** Every claim on a clean item, from checks/<candidate>__<input>__t<n>/findings-match.json of each trial a findings-match check graded. */
export async function loadDefectClaims(dir: string, trials: readonly TrialRow[]): Promise<DefectClaim[]> {
  const graded = trials.filter((t) => Object.values(t.checks ?? {}).some((c) => c.version?.startsWith(KIND_PREFIX)));
  const perTrial = await Promise.all(
    graded.map(async (t) => {
      const file = path.join(dir, "checks", `${safeName(t.candidate)}__${t.input}__t${t.trial}`, DECISIONS_FILE);
      // Missing or not JSON: this trial has nothing to show.
      const record = await fs.readFile(file, "utf-8").then((text) => JSON.parse(text) as unknown).catch(() => null);
      return claimsOfRecord(record).map((c): DefectClaim => ({ candidate: t.candidate, input: t.input, trial: t.trial, ...c }));
    }),
  );
  return perTrial.flat();
}

export interface ClaimRow {
  input: string;
  total: number;
  /** Claims per candidate, over all its trials on this input. */
  counts: Record<string, number>;
  claims: DefectClaim[];
}

/** One row per clean item that drew a claim, the most claimed first. */
export function claimBoard(claims: readonly DefectClaim[], candidates: readonly string[]): ClaimRow[] {
  const inputs = [...new Set(claims.map((c) => c.input))];
  return inputs
    .map((input): ClaimRow => {
      const own = claims.filter((c) => c.input === input && candidates.includes(c.candidate));
      return { input, total: own.length, counts: Object.fromEntries(candidates.map((c) => [c, own.filter((x) => x.candidate === c).length])), claims: own };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.input.localeCompare(b.input));
}

function claimLine(c: DefectClaim): string {
  const cut = c.message.length > MESSAGE_CHARS ? `${c.message.slice(0, MESSAGE_CHARS)} …` : c.message;
  return `<div class="cmp-trial"><span class="mono muted">${escapeHtml(`${c.candidate} · t${c.trial} · ${c.where}`)}</span><div>${escapeHtml(cut)}</div></div>`;
}

/** The section; empty when no clean item drew a claim (or no record could be read). */
export function renderClaims(board: readonly ClaimRow[], candidates: readonly string[]): string {
  if (board.length === 0) return "";
  const rows = board
    .map(
      (r) => `<details class="cmp-row"><summary class="cmp-grid"><span class="mono cmp-input">${escapeHtml(r.input)}</span>${candidates.map((c) => `<span class="cmp-cell">${r.counts[c] ?? 0}</span>`).join("")}</summary>
      <div class="cmp-trials">${r.claims.map(claimLine).join("")}</div></details>`,
    )
    .join("");
  return `<section class="card">
    <h2>Defect claims on clean items <span class="hint">the findings the matcher counted as claiming a defect, over every trial · most claimed first · open a row for what was said</span></h2>
    <div class="cmp" style="--cols:${candidates.length}">
      <div class="cmp-grid cmp-head"><span>Input</span>${candidates.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>
      ${rows}
    </div>
    <p class="note">Clean means no later fix traced a bug to the PR, not that it has none: a claim here may be a real bug nobody fixed. Read the noisiest ones before calling them false alarms.</p>
  </section>`;
}
