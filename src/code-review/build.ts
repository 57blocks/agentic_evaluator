/**
 * `code-review build`: confirmed candidates (and picked clean PRs) become a
 * task's items.jsonl and fixtures/<id>/, in the item shape of
 * docs/design/code-review.md.
 *
 * One item per PR: an escaped item lists every confirmed defect the PR
 * shipped (one entry per fix and file), so a reviewer reviews each PR once.
 * Nothing about the fix goes under fixtures/: the reviewer reads those; the
 * answer key is the item's `expected`, which agenteval withholds.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { diffNames, git } from "./git.js";
import { isPinned, type Pin } from "./pin.js";
import type { GitHub, PullDetail } from "./github.js";
import { writeBundle } from "./fixture-bundle.js";
import { locateDefect, type Location } from "./locate.js";
import { resolveRange, type PrRange } from "./pr-range.js";
import { checkMinedShas, toJson } from "./candidates-file.js";
import { CATEGORIES, SEVERITIES, unitId, type Candidate, type CleanFile, type CleanPick, type MinedFile, type Unit } from "./types.js";

export const MAX_FIX_DIFF = 6000;
export const BUILD_REPORT = "code-review-build.json";

export interface BuildOptions {
  repo: string;
  mined: MinedFile;
  clean: CleanFile | null;
  taskDir: string;
  github: GitHub | null;
  includeUnconfirmed: boolean;
  /** Paths from one commit laid over every fixture tree (`--pin-files`). */
  pin?: Pin | null;
  log?: (line: string) => void;
}

export interface Defect {
  file: string;
  start_line?: number;
  end_line?: number;
  category: string;
  severity?: string;
  description: string;
  fix_commit: string;
  fix_diff: string;
}

export interface Item {
  id: string;
  input: string;
  expected: { kind: "defect"; source: "escaped"; defects: Defect[] } | { kind: "clean"; note: string };
  tags: string[];
  split: "dev";
  provenance: Record<string, unknown>;
}

export interface BuildReport {
  items: { id: string; kind: "escaped" | "clean"; merged_as: PrRange["kind"]; commits: number; defects?: number }[];
  /** Candidates left out before building, and why. */
  excluded: { candidate: string; reason: string }[];
  /** Units (or single candidates) that could not be built, and why. */
  skipped: { id: string; reason: string }[];
  /** Defect lines that could not be placed in the PR head. */
  unlocated: { item: string; candidate: string; file: string; note: string }[];
  /** Labels that were not in the taxonomy and became "other", or were dropped. */
  relabelled: { candidate: string; field: string; was: string }[];
  /** Fixture directories already there that this build did not write. */
  stale_fixtures: string[];
  /** With --pin-files: the commit and paths every fixture tree carries. */
  pinned?: { commit: string; paths: string[] };
  /** Items whose PR itself changed a pinned path: the pin hides that part of its diff. */
  pinned_edited?: { item: string; paths: string[] }[];
}

function selected(c: Candidate, includeUnconfirmed: boolean): string | null {
  if (c.confirmed === true) return null;
  if (c.confirmed === false) return "a person marked it not a defect";
  if (!includeUnconfirmed) return "not confirmed (pass --include-unconfirmed to build it anyway)";
  if (c.prescreen?.verdict === "not_defect") return "unconfirmed, and the pre-screen says not_defect";
  return null;
}

function provenanceLabel(c: Candidate): string {
  if (c.confirmed === true) return "human-confirmed";
  return c.prescreen ? `unconfirmed (included with --include-unconfirmed; pre-screen ${c.prescreen.verdict})` : "unconfirmed (included with --include-unconfirmed; not pre-screened)";
}

function clip(text: string): string {
  return text.length <= MAX_FIX_DIFF ? text : `${text.slice(0, MAX_FIX_DIFF)}\n[... truncated]`;
}

function labelOf(c: Candidate, report: BuildReport): { category: string; severity?: string; description: string } {
  const rawCat = c.label?.category ?? c.prescreen?.category;
  const rawSev = c.label?.severity ?? c.prescreen?.severity;
  let category = "other";
  if (rawCat !== undefined) {
    if ((CATEGORIES as readonly string[]).includes(rawCat)) category = rawCat;
    else report.relabelled.push({ candidate: c.id, field: "category", was: rawCat });
  }
  let severity: string | undefined;
  if (rawSev !== undefined) {
    if ((SEVERITIES as readonly string[]).includes(rawSev)) severity = rawSev;
    else report.relabelled.push({ candidate: c.id, field: "severity", was: rawSev });
  }
  const description = c.label?.description ?? c.prescreen?.defect ?? `Fixed later by ${c.fix.sha.slice(0, 10)}: ${c.fix.subject}`;
  return { category, ...(severity ? { severity } : {}), description };
}

async function defectsOf(opts: BuildOptions, itemId: string, c: Candidate, range: PrRange, report: BuildReport): Promise<Defect[]> {
  const fixParent = (await git(opts.repo, ["rev-parse", "--verify", "--end-of-options", `${c.fix.sha}^1`])).trim();
  const locations: Location[] = await locateDefect(opts.repo, fixParent, range.head, c.blamed, new Set(range.members));
  const label = labelOf(c, report);
  const fixDiff = clip(await git(opts.repo, ["show", "--format=", "--no-color", "--no-ext-diff", "--end-of-options", c.fix.sha, "--", ...c.files]));
  return locations.map((loc) => {
    if (loc.note) report.unlocated.push({ item: itemId, candidate: c.id, file: loc.file, note: loc.note });
    return {
      file: loc.file,
      ...(loc.start_line !== undefined ? { start_line: loc.start_line, end_line: loc.end_line } : {}),
      ...label,
      fix_commit: c.fix.sha.slice(0, 10),
      fix_diff: fixDiff,
    };
  });
}

async function commitMessage(repo: string, sha: string): Promise<{ headline: string; body: string }> {
  const msg = await git(repo, ["show", "-s", "--format=%B", "--end-of-options", sha]);
  const [headline, ...rest] = msg.split("\n");
  return { headline, body: rest.join("\n").trim() };
}

async function writeFixture(opts: BuildOptions, itemId: string, unit: Unit, range: PrRange, pull: PullDetail | null, report: BuildReport): Promise<void> {
  const dir = path.join(opts.taskDir, "fixtures", itemId);
  await fs.rm(dir, { recursive: true, force: true });
  const pin = opts.pin ?? null;
  if (pin) {
    const edited = (await diffNames(opts.repo, range.base, range.head)).filter((f) => isPinned(f, pin)).sort();
    if (edited.length > 0) report.pinned_edited!.push({ item: itemId, paths: edited });
  }
  const built = await writeBundle(opts.repo, range.base, range.replay, `refs/fixtures/${itemId}`, path.join(dir, "repo.bundle"), pin);
  const commits = [];
  for (const [i, original] of range.replay.entries()) {
    const m = await commitMessage(opts.repo, original);
    commits.push({ oid: built.commitShas[i], messageHeadline: m.headline, messageBody: m.body });
  }
  const first = await commitMessage(opts.repo, range.replay[0]);
  const authored = (await git(opts.repo, ["show", "-s", "--format=%aI", "--end-of-options", range.replay[0]])).trim();
  const pr = {
    repo: opts.mined.repo.github ?? path.basename(opts.repo),
    number: unit.kind === "pr" ? unit.number : null,
    title: pull?.title ?? (unit.kind === "pr" ? unit.title : first.headline),
    body: pull?.body ?? (unit.kind === "pr" ? "" : first.body),
    createdAt: pull?.createdAt ?? authored,
    baseRefName: pull?.baseRef ?? opts.mined.repo.branch,
    baseSha: built.baseSha,
    headSha: built.headSha,
    commits,
  };
  await fs.writeFile(path.join(dir, "pr.json"), toJson(pr));
}

function tagsOf(kind: string, defects: readonly Defect[]): string[] {
  const set = new Set<string>([kind]);
  for (const d of defects) set.add(d.category);
  for (const d of defects) set.add(d.severity ?? "severity-unknown");
  return [...set];
}

async function buildEscaped(opts: BuildOptions, unit: Unit, group: Candidate[], report: BuildReport): Promise<Item | null> {
  const id = unitId(unit);
  const resolved = await resolveRange(opts.repo, unit, opts.github);
  if ("skip" in resolved) {
    report.skipped.push({ id, reason: resolved.skip });
    return null;
  }
  const { range, pull } = resolved;
  const members = new Set(range.members);
  const kept = group.filter((c) => {
    if (members.has(c.introducing.sha)) return true;
    report.skipped.push({ id: c.id, reason: `introducer ${c.introducing.sha.slice(0, 9)} is not among the PR's ${range.members.length} commits (${range.kind} merge)` });
    return false;
  });
  if (kept.length === 0) return null;
  const defects: Defect[] = [];
  for (const c of kept) defects.push(...(await defectsOf(opts, id, c, range, report)));
  await writeFixture(opts, id, unit, range, pull, report);
  report.items.push({ id, kind: "escaped", merged_as: range.kind, commits: range.replay.length, defects: defects.length });
  return {
    id,
    input: id,
    expected: { kind: "defect", source: "escaped", defects },
    tags: tagsOf("escaped", defects),
    split: "dev",
    provenance: {
      built_by: "agenteval code-review build",
      unit,
      merged_as: range.kind,
      label: kept.every((c) => c.confirmed === true) ? "human-confirmed" : "includes unconfirmed candidates",
      candidates: kept.map((c) => ({
        id: c.id,
        fix: c.fix.sha,
        fix_unit: c.fix.unit,
        introducing: c.introducing.sha,
        confirmed: c.confirmed,
        label: provenanceLabel(c),
        ...(c.prescreen ? { prescreen: { model: c.prescreen.model, verdict: c.prescreen.verdict, confidence: c.prescreen.confidence } } : {}),
      })),
    },
  };
}

async function buildClean(opts: BuildOptions, pick: CleanPick, clean: CleanFile, report: BuildReport): Promise<Item | null> {
  const id = `${unitId(pick.unit)}-clean`;
  const resolved = await resolveRange(opts.repo, pick.unit, opts.github);
  if ("skip" in resolved) {
    report.skipped.push({ id, reason: resolved.skip });
    return null;
  }
  await writeFixture(opts, id, pick.unit, resolved.range, resolved.pull, report);
  report.items.push({ id, kind: "clean", merged_as: resolved.range.kind, commits: resolved.range.replay.length });
  const window = `${clean.window.since} to ${clean.window.until ?? "the mined head"}`;
  return {
    id,
    input: id,
    expected: { kind: "clean", note: `no fix mined from ${window} blamed a line this change wrote; not proof that it has no defect` },
    tags: ["clean", `lines:${pick.bin}`],
    split: "dev",
    provenance: { built_by: "agenteval code-review build", unit: pick.unit, merged_as: resolved.range.kind, lines: pick.lines, files: pick.files, seed: clean.seed, label: "szz-clean, not human-confirmed" },
  };
}

async function staleFixtures(taskDir: string, built: ReadonlySet<string>): Promise<string[]> {
  const entries = await fs.readdir(path.join(taskDir, "fixtures"), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !built.has(e.name)).map((e) => e.name).sort();
}

export async function build(opts: BuildOptions): Promise<{ items: Item[]; report: BuildReport }> {
  checkMinedShas(opts.mined);
  const report: BuildReport = {
    items: [], excluded: [], skipped: [], unlocated: [], relabelled: [], stale_fixtures: [],
    ...(opts.pin ? { pinned: { commit: opts.pin.commit, paths: opts.pin.paths }, pinned_edited: [] } : {}),
  };
  const groups = new Map<string, { unit: Unit; candidates: Candidate[] }>();
  for (const c of opts.mined.candidates) {
    const why = selected(c, opts.includeUnconfirmed);
    if (why) {
      report.excluded.push({ candidate: c.id, reason: why });
      continue;
    }
    const key = unitId(c.introducing.unit);
    groups.set(key, { unit: c.introducing.unit, candidates: [...(groups.get(key)?.candidates ?? []), c] });
  }
  const items: Item[] = [];
  for (const key of [...groups.keys()].sort()) {
    const { unit, candidates } = groups.get(key)!;
    opts.log?.(`${key}: ${candidates.length} defect candidate${candidates.length > 1 ? "s" : ""}`);
    const item = await buildEscaped(opts, unit, candidates, report);
    if (item) items.push(item);
  }
  for (const pick of opts.clean?.picked ?? []) {
    opts.log?.(`${unitId(pick.unit)}-clean`);
    const item = await buildClean(opts, pick, opts.clean!, report);
    if (item) items.push(item);
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  report.items.sort((a, b) => a.id.localeCompare(b.id));
  report.pinned_edited?.sort((a, b) => a.item.localeCompare(b.item));
  report.stale_fixtures = await staleFixtures(opts.taskDir, new Set(items.map((i) => i.id)));
  return { items, report };
}

export async function writeBuild(taskDir: string, items: readonly Item[], report: BuildReport): Promise<void> {
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, "items.jsonl"), items.map((i) => `${JSON.stringify(i)}\n`).join(""));
  await fs.writeFile(path.join(taskDir, BUILD_REPORT), toJson(report));
}
