/**
 * Reading and writing what `mine` and `pick-clean` produce: JSON for the
 * tools, and candidates.md, a table a person reads while setting
 * `confirmed` in candidates.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { assertSha, GitError } from "./git.js";
import type { Candidate, CleanFile, MinedFile, Unit } from "./types.js";

export const CANDIDATES_JSON = "candidates.json";
export const CANDIDATES_MD = "candidates.md";
export const CLEAN_JSON = "clean.json";

export class CandidatesError extends Error {}

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`;
}

async function readJson<T>(file: string, what: string): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    throw new CandidatesError(`no ${what} at ${file}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new CandidatesError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

function checkUnit(unit: Unit | undefined, where: string): void {
  if (unit?.kind === "commit") assertSha(unit.sha, `${where} unit sha`);
  else if (unit?.kind === "pr" && !Number.isInteger(unit.number)) throw new GitError(`${where}: PR number ${JSON.stringify(unit.number)} is not a whole number`);
}

/**
 * Every commit id in a mined file reaches git as an argument: a value that is
 * not an id (say, "--output=x") is refused before any git call.
 */
export function checkMinedShas(mined: MinedFile): void {
  assertSha(mined.repo?.head, "repo.head");
  mined.introducers.forEach((s, i) => assertSha(s, `introducers[${i}]`));
  for (const c of mined.candidates) {
    assertSha(c.fix?.sha, `${c.id}: fix.sha`);
    assertSha(c.introducing?.sha, `${c.id}: introducing.sha`);
    checkUnit(c.fix?.unit, `${c.id}: fix`);
    checkUnit(c.introducing?.unit, `${c.id}: introducing`);
    for (const o of c.others ?? []) assertSha(o.sha, `${c.id}: others`);
    for (const b of c.blamed ?? []) assertSha(b.sha, `${c.id}: blamed`);
  }
}

export async function readMined(dir: string): Promise<MinedFile> {
  const mined = await readJson<MinedFile>(path.join(dir, CANDIDATES_JSON), "candidates.json (from `code-review mine`)");
  if (mined.version !== 1 || !Array.isArray(mined.candidates) || !Array.isArray(mined.introducers)) {
    throw new CandidatesError(`${path.join(dir, CANDIDATES_JSON)} is not a candidates file written by \`code-review mine\``);
  }
  try {
    checkMinedShas(mined);
  } catch (err) {
    if (err instanceof GitError) throw new CandidatesError(`${path.join(dir, CANDIDATES_JSON)}: ${err.message}`);
    throw err;
  }
  for (const c of mined.candidates) {
    if (c.confirmed !== null && typeof c.confirmed !== "boolean") {
      throw new CandidatesError(`${c.id}: "confirmed" must be true, false or null, got ${JSON.stringify(c.confirmed)}`);
    }
    const { knowable, confirmed_by: confirmedBy } = c.label ?? {};
    if (knowable !== undefined && typeof knowable !== "boolean") {
      throw new CandidatesError(`${c.id}: "label.knowable" must be true or false, got ${JSON.stringify(knowable)}`);
    }
    if (confirmedBy !== undefined && (typeof confirmedBy !== "string" || confirmedBy.trim() === "")) {
      throw new CandidatesError(`${c.id}: "label.confirmed_by" must be non-empty text, got ${JSON.stringify(confirmedBy)}`);
    }
  }
  return mined;
}

/**
 * The earlier candidates.json, or null when there is none yet. A file that
 * is there but does not read is an error, never "none": a re-mine would
 * otherwise write over the marks a person set by hand.
 */
export async function readMinedIfAny(dir: string): Promise<MinedFile | null> {
  const present = await fs.stat(path.join(dir, "candidates.json")).then(() => true, (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return false;
    throw err;
  });
  return present ? readMined(dir) : null;
}

export async function readClean(dir: string): Promise<CleanFile> {
  const clean = await readJson<CleanFile>(path.join(dir, CLEAN_JSON), "clean.json (from `code-review pick-clean`)");
  if (clean.version !== 1 || !Array.isArray(clean.picked)) throw new CandidatesError(`${path.join(dir, CLEAN_JSON)} is not written by \`code-review pick-clean\``);
  try {
    clean.picked.forEach((p, i) => checkUnit(p.unit, `picked[${i}]`));
  } catch (err) {
    if (err instanceof GitError) throw new CandidatesError(`${path.join(dir, CLEAN_JSON)}: ${err.message}`);
    throw err;
  }
  return clean;
}

function cell(text: string, max = 90): string {
  const one = text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function unitLink(unit: Unit, github: string | null): string {
  if (unit.kind === "pr") {
    const label = `#${unit.number}`;
    return `${github ? `[${label}](https://github.com/${github}/pull/${unit.number})` : label} ${cell(unit.title, 50)}`;
  }
  return `${commitLink(unit.sha, github)} ${cell(unit.title, 50)}`;
}

function commitLink(sha: string, github: string | null): string {
  const short = sha.slice(0, 9);
  return github ? `[${short}](https://github.com/${github}/commit/${sha})` : `\`${short}\``;
}

function screenCells(c: Candidate): string[] {
  const s = c.prescreen;
  if (!s) return ["", "", ""];
  const conf = s.confidence === undefined ? "" : String(s.confidence);
  return [`${s.verdict}${conf ? ` ${conf}` : ""}`, [s.category, s.severity].filter(Boolean).join(" / "), cell(s.defect ?? s.reason ?? "")];
}

export function candidatesMarkdown(mined: MinedFile): string {
  const gh = mined.repo.github;
  const screened = mined.candidates.filter((c) => c.prescreen).length;
  const lines = [
    `# Escaped-defect candidates: ${gh ?? mined.repo.branch}`,
    "",
    `Mined by \`agenteval code-review mine\` from ${mined.repo.branch} (${mined.repo.head.slice(0, 9)}), fix commits ${mined.window.since} to ${mined.window.until ?? "now"}: ` +
      `${mined.scanned.fixes} fixes among ${mined.scanned.commits} first-parent commits, ${mined.candidates.length} candidates, ${mined.dropped.length} dropped (reasons in candidates.json).`,
    `Filters: at most ${mined.settings.max_removed_lines} removed lines of code; the top introducer owns at least ${Math.round(mined.settings.min_owner_share * 100)}% of the blamed lines; ` +
      `not a chore/style/ci introducer; introducer and fix in different ${gh ? "PRs" : "commits"}. Blame: \`${mined.settings.blame.join(" ")}\`.`,
    screened > 0 ? `${screened} pre-screened by a model: a first pass, never the label.` : "Not pre-screened.",
    "",
    "**To confirm, set `\"confirmed\": true` (or `false`) on the candidate in candidates.json; `build` reads only that file.** The column below is for notes while reading.",
    "",
    "| # | id | introducing | fix | removed | owner | pre-screen | category / severity | defect (pre-screen) | confirmed |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [i, c] of mined.candidates.entries()) {
    const confirmed = c.confirmed === true ? "yes" : c.confirmed === false ? "no" : "";
    lines.push(
      `| ${i + 1} | ${c.id} | ${unitLink(c.introducing.unit, gh)} | ${commitLink(c.fix.sha, gh)} ${cell(c.fix.subject, 60)} | ${c.removed_lines} | ${Math.round(c.introducing.share * 100)}% | ${screenCells(c).join(" | ")} | ${confirmed} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function writeMined(dir: string, mined: MinedFile): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, CANDIDATES_JSON), toJson(mined));
  await fs.writeFile(path.join(dir, CANDIDATES_MD), candidatesMarkdown(mined));
}
