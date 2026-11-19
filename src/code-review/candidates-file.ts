/**
 * Reading and writing what `mine` and `pick-clean` produce: JSON for the
 * tools, and candidates.md, a table a person reads while setting
 * `confirmed` in candidates.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
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

export async function readMined(dir: string): Promise<MinedFile> {
  const mined = await readJson<MinedFile>(path.join(dir, CANDIDATES_JSON), "candidates.json (from `code-review mine`)");
  if (mined.version !== 1 || !Array.isArray(mined.candidates) || !Array.isArray(mined.introducers)) {
    throw new CandidatesError(`${path.join(dir, CANDIDATES_JSON)} is not a candidates file written by \`code-review mine\``);
  }
  for (const c of mined.candidates) {
    if (c.confirmed !== null && typeof c.confirmed !== "boolean") {
      throw new CandidatesError(`${c.id}: "confirmed" must be true, false or null, got ${JSON.stringify(c.confirmed)}`);
    }
  }
  return mined;
}

export async function readMinedIfAny(dir: string): Promise<MinedFile | null> {
  return readMined(dir).catch(() => null);
}

export async function readClean(dir: string): Promise<CleanFile> {
  const clean = await readJson<CleanFile>(path.join(dir, CLEAN_JSON), "clean.json (from `code-review pick-clean`)");
  if (clean.version !== 1 || !Array.isArray(clean.picked)) throw new CandidatesError(`${path.join(dir, CLEAN_JSON)} is not written by \`code-review pick-clean\``);
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
