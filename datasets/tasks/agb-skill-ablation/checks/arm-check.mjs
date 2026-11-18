#!/usr/bin/env node
/**
 * Was the trial the arm it claims to be? Read from the claude event stream
 * the candidate left (.eval-trace.jsonl, every session appended).
 *
 *   *-skill  agb's plugin (agb-skills) was loaded with its /agb-code command,
 *            and the session acted on it: it ran agb's CLI (./.ab/bin/agb,
 *            which the command's first step is), invoked an agb-skills skill
 *            or read one of its packs. The command's packs are spliced into
 *            the prompt when it expands, which the stream does not echo, so a
 *            real stage run shows no Skill call and no pack read; agb's CLI is
 *            what it visibly does (checked on agb-flow-v3's test-design trace).
 *   *-none   no agb-skills plugin, no agb command listed, no agb-skills skill,
 *            no read under the plugin, no agb CLI call. Claude Code's built-in
 *            plugins and skills are in both arms alike and are not counted.
 *
 * Exit 0: the arm held. Exit 2 (an evaluator error, never the candidate's
 * failure): it did not, so the trial does not measure what it is labelled
 * as and is void, neither a success nor a failure. Soroban taught this: a
 * skill installed and never loaded reads as "skill did not help".
 *
 * Without a candidate in meta.json (check-task on a reference or the
 * untouched start) there is no arm to check: it passes and says so.
 */

import { existsSync, readFileSync } from "node:fs";

const meta = existsSync("meta.json") ? JSON.parse(readFileSync("meta.json", "utf-8")) : {};
const report = (code, evidence, reason) => {
  console.log(JSON.stringify(reason ? { evidence, reason } : { evidence }));
  process.exit(code);
};

const candidate = typeof meta.candidate === "string" ? meta.candidate : null;
const arm = candidate?.endsWith("-skill") ? "skill" : candidate?.endsWith("-none") ? "none" : null;
if (arm === null) report(0, candidate ? `candidate ${candidate} names no arm (-skill / -none): nothing to check` : "no candidate (a reference or the untouched start): nothing to check");
if (!existsSync(".eval-trace.jsonl")) report(2, "no .eval-trace.jsonl: the arm cannot be confirmed", "arm unconfirmed: no trace");

const events = readFileSync(".eval-trace.jsonl", "utf-8").split("\n").filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);
const inits = events.filter((e) => e.type === "system" && e.subtype === "init");
if (inits.length === 0) report(2, "the trace has no session init line", "arm unconfirmed: no init");

const isAgb = (s) => typeof s === "string" && /agb-skills/.test(s);
const pluginLoaded = inits.some((i) => (i.plugins ?? []).some((p) => isAgb(p?.name) || isAgb(p?.source)));
// The init line lists a plugin's commands without the plugin prefix (agb-code), skills with or without it.
const agbListed = inits.some((i) => [...(i.skills ?? []), ...(i.slash_commands ?? [])].some((s) => isAgb(s) || /^agb-[a-z-]+$/.test(String(s))));
const codeCommandListed = inits.some((i) => (i.slash_commands ?? []).some((s) => s === "agb-code" || s === "agb-skills:agb-code"));
const nonBuiltin = [...new Set(inits.flatMap((i) => (i.plugins ?? []).filter((p) => p?.path !== "builtin").map((p) => p?.name ?? "?")))];

const calls = events
  .filter((e) => e.type === "assistant")
  .flatMap((e) => (e.message?.content ?? []).filter((b) => b?.type === "tool_use"));
const skillCalls = calls.filter((c) => c.name === "Skill");
const agbSkillCalls = skillCalls.filter((c) => isAgb(c.input?.skill ?? c.input?.name ?? JSON.stringify(c.input ?? {})));
const packReads = calls.filter((c) => c.name === "Read" && /skills\/dist\/packages\/claude-code\//.test(String(c.input?.file_path ?? "")));
// ./.ab/bin/agb, or a bare `agb <subcommand>` (a global agb, shadowed in the run).
const AGB_CALL = /\.ab\/bin\/agb\b|(?:^|[\s;&|(`])agb\s+(?:check|run|status|skills|self|init|questions)\b/;
const agbCli = calls.filter((c) => c.name === "Bash" && AGB_CALL.test(String(c.input?.command ?? "")));
// The plugin's packs read some other way than the Read tool (cat, sed under the plugin dir).
const packShell = calls.filter((c) => c.name === "Bash" && /skills\/dist\/packages\/claude-code\//.test(String(c.input?.command ?? "")));
// `agb run --dry-run` / `--help` only print (a test-design session does both).
const agbRuns = agbCli.filter((c) => /\.ab\/bin\/agb\s+run\b(?![^\n;|&]*--(?:dry-run|help))/.test(String(c.input?.command ?? "")));

const facts =
  `${inits.length} session(s); agb-skills plugin ${pluginLoaded ? "loaded" : "not loaded"}; ` +
  `non-builtin plugins: ${nonBuiltin.length ? nonBuiltin.join(", ") : "none"}; ` +
  `/agb-code ${codeCommandListed ? "listed" : "not listed"}; Skill calls ${skillCalls.length} (agb-skills ${agbSkillCalls.length}); ` +
  `agb pack reads ${packReads.length + packShell.length}; agb CLI calls ${agbCli.length} (agb run ${agbRuns.length})`;

if (arm === "skill") {
  if (!pluginLoaded || !codeCommandListed) report(2, facts, "skill arm without the agb-skills plugin's /agb-code: void");
  if (agbCli.length + agbSkillCalls.length + packReads.length + packShell.length === 0) report(2, facts, "skill arm never acted on agb's skills (no agb CLI call, skill or pack): void");
  const others = nonBuiltin.filter((n) => !isAgb(n));
  if (others.length > 0) report(2, facts, `skill arm loaded another non-builtin plugin (${others.join(", ")}): void`);
  report(0, facts);
}
if (pluginLoaded || agbListed || agbCli.length + agbSkillCalls.length + packReads.length + packShell.length > 0) report(2, facts, "no-skill arm reached agb's skills: void");
if (nonBuiltin.length > 0) report(2, facts, `no-skill arm loaded a non-builtin plugin (${nonBuiltin.join(", ")}): void`);
report(0, facts);
