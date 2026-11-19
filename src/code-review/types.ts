/**
 * The files the code-review builders hand each other: `mine` writes
 * candidates.json, `pick-clean` writes clean.json, `build` reads both. Keys
 * are snake_case like every other file agenteval writes for people to edit.
 * The item shape `build` emits is the shared contract in
 * docs/design/code-review.md.
 */

/** The defect taxonomy of docs/design/code-review.md. */
export const CATEGORIES = [
  "calculation", "logic", "crash", "state", "data", "security", "privacy",
  "accessibility", "concurrency", "resource", "ui", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** What a change landed as: a merged PR, or (with no GitHub) one commit. */
export type Unit =
  | { kind: "pr"; number: number; title: string; merged_at: string | null }
  | { kind: "commit"; sha: string; title: string };

export function unitId(unit: Unit): string {
  return unit.kind === "pr" ? `pr${unit.number}` : `c${unit.sha.slice(0, 7)}`;
}

/** One removed line of a fix, blamed at the fix's parent. */
export interface BlamedLine {
  /** Path and line at the fix's parent. */
  file: string;
  line: number;
  /** The commit blame names, and the path and line in that commit. */
  sha: string;
  orig_file: string;
  orig_line: number;
}

export interface Introducer {
  sha: string;
  date: string;
  subject: string;
  /** Removed lines blamed on it, and their share of all blamed lines. */
  lines: number;
  share: number;
}

export interface Prescreen {
  model: string;
  verdict: "defect" | "not_defect" | "unsure" | "error";
  category?: string;
  severity?: string;
  visible_in_introducing_diff?: boolean;
  defect?: string;
  file?: string;
  confidence?: number;
  reason?: string;
  cost_usd?: number;
}

/** What a person writes when they confirm a candidate; overrides the pre-screen. */
export interface Label {
  category?: string;
  severity?: string;
  description?: string;
}

export interface Candidate {
  /** <unit>-fix<sha7>, e.g. pr4160-fix0e053ea. */
  id: string;
  fix: { sha: string; date: string; subject: string; unit: Unit };
  introducing: Introducer & { unit: Unit };
  /** The other commits blame named, most lines first. */
  others: Introducer[];
  files: string[];
  removed_lines: number;
  blamed: BlamedLine[];
  /** Set by a person: true goes into `build`, false never does. null = not reviewed. */
  confirmed: boolean | null;
  label?: Label;
  prescreen?: Prescreen;
}

export interface Dropped {
  fix: string;
  subject: string;
  reason: string;
  /** The top introducer, when blame got that far. */
  introducing?: string;
}

export interface MinedFile {
  version: 1;
  repo: { github: string | null; branch: string; head: string };
  window: { since: string; until: string | null };
  settings: { fix_pattern: string | null; max_removed_lines: number; min_owner_share: number; blame: string[] };
  scanned: { commits: number; fixes: number };
  /** Every commit any scanned fix's blame named, before any filter: what `pick-clean` must avoid. */
  introducers: string[];
  candidates: Candidate[];
  dropped: Dropped[];
}

export interface CleanPick {
  unit: Unit;
  lines: number;
  files: number;
  commits: number;
  bin: string;
}

export interface CleanFile {
  version: 1;
  seed: number;
  repo: { github: string | null; branch: string };
  window: { since: string; until: string | null };
  /** What the bins were sized from. */
  matched_to: string;
  bins: { lo: number; hi: number | null; escaped: number; want: number; got: number }[];
  picked: CleanPick[];
  rejected: { unit: string; reason: string }[];
}
