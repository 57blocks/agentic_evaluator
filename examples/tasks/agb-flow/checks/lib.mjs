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

export const cwd = process.cwd();
export const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb");
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

/** agb reads `git ls-files` to see the project; a work dir has no history. */
export function ensureGit(dir = cwd) {
  if (existsSync(path.join(dir, ".git"))) return;
  const g = (...a) => sh("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...a], { minutes: 2, dir });
  g("init", "-q");
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

/** "gate N, gate M" for the findings of a severity, most frequent first. */
export function countByGate(findings) {
  const by = {};
  for (const f of findings) by[f.gate] = (by[f.gate] ?? 0) + 1;
  return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(", ") || "none";
}
