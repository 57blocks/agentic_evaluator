/**
 * What every agb-flow check shares: the result contract, the agb CLI, and
 * reading what agb's gates found.
 *
 * Contract (agenteval src/check.ts): cwd holds the candidate's files, plus
 * input.txt and meta.json ({step, input, fixture, chained, ...}); print
 * {"evidence", "reason"}; exit 0 pass, 1 fail, 2 the check itself broke.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const cwd = process.cwd();
export const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb-eval");
const AGB = [path.join(AGB_HOME, "node_modules", ".bin", "tsx"), path.join(AGB_HOME, "packages", "agb", "src", "run", "cli.ts")];
const ANSI = /\x1b\[[0-9;]*m/g;
/** A registry or network failure: the setup's, not the candidate's. */
export const NETWORK = /ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|50[234] /i;

export function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

export function readJson(file, dir = cwd) {
  try {
    return JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  } catch {
    return null;
  }
}

export const meta = () => readJson("meta.json") ?? {};

export function sh(cmd, args, { minutes = 10, dir = cwd } = {}) {
  return spawnSync(cmd, args, { cwd: dir, encoding: "utf-8", timeout: minutes * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
}

/**
 * agb reads `git ls-files` to see the project. A work dir may have no history,
 * or files the candidate left uncommitted: what is graded is what is on disk.
 */
export function ensureGit(dir = cwd) {
  const g = (...a) => sh("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...a], { minutes: 2, dir });
  if (!existsSync(path.join(dir, ".git"))) g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "--allow-empty", "-m", "agb-flow: graded state");
}

/**
 * Run an agb command and read back what its gates found. Exits 2 when agb
 * is missing or crashed: a broken ruler is not the candidate's fault.
 */
export function agb(args, { minutes = 10 } = {}) {
  if (!AGB.every(existsSync)) finish(2, `agb not found under ${AGB_HOME} (set AGB_HOME)`, "agb not found");
  const events = path.join(cwd, ".ab", "events.jsonl");
  rmSync(events, { force: true });
  const r = sh(AGB[0], [AGB[1], ...args], { minutes });
  const report = `${r.stdout ?? ""}`.replace(ANSI, "");
  if (r.error || (r.status !== 0 && r.status !== 1)) {
    finish(2, `agb ${args.join(" ")} exited with ${r.status ?? r.error?.message}: ${`${r.stderr ?? ""}${report}`.slice(-600)}`, "agb did not run");
  }
  const findings = existsSync(events)
    ? readFileSync(events, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "gate.finding")
    : [];
  const lines = report.split("\n");
  // The line under a finding's header says what is wrong (newer agb redacts it in events).
  const headlines = [];
  lines.forEach((line, i) => {
    const head = /^\[(hard|partial|info)\]\s+(\S+)/.exec(line);
    if (head) headlines.push({ severity: head[1], gate: head[2], text: (lines[i + 1] ?? "").trim() });
  });
  return { findings, headlines, report };
}

/** The first JSON object in a text that may carry more after it (agb prints a footer). */
function firstObject(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/**
 * Every hard and partial finding agb reports at a stage, from
 * `agb check --all --json` (the whole verdict, untruncated). Exits 2 when agb
 * is missing, crashed, or printed no verdict.
 */
export function stageFindings(stage, { minutes = 10 } = {}) {
  if (!AGB.every(existsSync)) finish(2, `agb not found under ${AGB_HOME} (set AGB_HOME)`, "agb not found");
  const r = sh(AGB[0], [AGB[1], "check", "--all", `--stage=${stage}`, "--json"], { minutes });
  const out = `${r.stdout ?? ""}`;
  if (r.error || (r.status !== 0 && r.status !== 1)) {
    finish(2, `agb check --stage=${stage} exited with ${r.status ?? r.error?.message}: ${`${r.stderr ?? ""}${out}`.slice(-600)}`, "agb did not run");
  }
  let verdict;
  try {
    verdict = firstObject(out);
  } catch (e) {
    finish(2, `agb check --json printed no readable verdict (${e.message}): ${out.slice(0, 300)}`, "agb verdict unreadable");
  }
  return (verdict.findings ?? []).filter((f) => f.severity === "hard" || f.severity === "partial");
}

/**
 * The rule the spec and architecture checks share, calibrated on the adopted
 * projects, none of which has a hard finding at its stage: fail on any hard
 * finding, or on a partial from a gate in `strict` (gates every adopted
 * project is clean on). Every other partial is counted, never gated on.
 */
export function gradeStage(stage, { strict, summary }) {
  ensureGit();
  const findings = stageFindings(stage);
  const blocking = findings.filter((f) => f.severity === "hard" || strict.includes(f.gate));
  const noted = findings.filter((f) => !blocking.includes(f));
  const line = `${summary}. Partials (recorded, not gated): ${countByGate(noted)}`;
  if (blocking.length === 0) finish(0, line);
  const say = (f) => `${f.severity} ${f.gate}: ${(f.message ?? "").slice(0, 200)}`;
  finish(1, `${line}. Fails: ${blocking.map(say).join("; ")}`, say(blocking[0]));
}

/** "gate N, gate M" for the findings of a severity, most frequent first. */
export function countByGate(findings) {
  const by = {};
  for (const f of findings) by[f.gate] = (by[f.gate] ?? 0) + 1;
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(", ") || "none";
}

// ── agb-skill-ablation ──────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
let armFacts = "";

/**
 * First, is the trial the arm it is labelled (arm-check.mjs)? One required
 * check per step, so every grader runs this before anything else. A trial
 * that is not is void: exit 2, an evaluator error, never the candidate's.
 */
export function confirmArm() {
  const r = spawnSync(process.execPath, [path.join(HERE, "arm-check.mjs")], { cwd, encoding: "utf-8", timeout: 60_000 });
  let out = null;
  try { out = JSON.parse((r.stdout ?? "").trim().split("\n").pop() ?? ""); } catch { /* reported below */ }
  armFacts = out?.evidence ?? `arm check printed nothing (exit ${r.status})`;
  if (r.status !== 0) finish(2, `arm: ${armFacts}`, out?.reason ?? "arm unconfirmed");
}

/**
 * Grade a planning step so that agb's format alone cannot decide it. The
 * check passes when the step's deliverables exist and parse (the caller has
 * already failed it otherwise); agb's REQUIRED gates become the score, the
 * share of them that came out clean, each failed one named in the evidence.
 * A no-skill arm that wrote a real plan in a shape agb's gates half-read is
 * then still eligible, and its judge verdict and cost still count.
 */
export function finishScored(summary, units) {
  const clean = units.filter((u) => u.clean);
  const score = units.length === 0 ? 1 : clean.length / units.length;
  const failed = units.filter((u) => !u.clean).map((u) => `${u.name}: ${u.detail}`);
  const evidence = `arm: ${armFacts}. ${summary}. agb's required gates clean ${clean.length}/${units.length}` +
    (failed.length ? `; not clean: ${failed.join("; ")}` : "");
  process.stdout.write(JSON.stringify({ evidence, score }));
  process.exit(0);
}

/** "gate: first message" for findings of one gate, or null when it is clean. */
export function gateDetail(findings, gate) {
  const own = findings.filter((f) => f.gate === gate);
  return own.length === 0 ? null : `${own.length} finding(s), e.g. ${(own[0].message ?? own[0].text ?? "").slice(0, 160)}`;
}
