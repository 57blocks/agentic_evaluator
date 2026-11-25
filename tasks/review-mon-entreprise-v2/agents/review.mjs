#!/usr/bin/env node
/**
 * Replay mon-entreprise's AI PR review on one historical PR.
 *
 *   node agents/review.mjs <prompt-file> <model> <max-cost-usd>
 *
 * Reproduces .github/workflows/pr-ai-review.yaml (claude-code-action, master
 * 2026-11-17) for an internal PR: the same prompt header (REPO, PR NUMBER,
 * COMMIT, BASE BRANCH, FORK: false) followed by one version of
 * .github/ai-review/instructions.md, the same --max-turns and the same
 * allowed Bash commands. What differs from production, identically in every
 * arm:
 *   - the repo is the fixture's standalone rebuild of the PR (history ends at
 *     the PR head, so the fix is out of reach), checked out outside the work dir;
 *   - gh is agents/bin/gh, which answers from the fixture and records what the
 *     reviewer posts instead of sending it; CI is reported green, linked
 *     issues and existing comments are withheld;
 *   - claude runs with a fresh config dir: none of this machine's settings,
 *     skills, MCP servers or memory.
 *
 * Writes findings.json in the work dir, the deliverable `kind: findings-match`
 * grades: one finding per posted comment (an inline comment keeps its file
 * and lines, a PR-level one has neither; replies to a thread are left out).
 * The reviewer never says whether a comment blocks, so `blocking` is absent.
 * Also writes {findings, gh, result} to review.json (what was posted, as
 * posted) and prints it. The fixture's repo.bundle and pr.json are removed
 * from the work dir afterwards so they are not kept as output.
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(TASK, "..", "..");
const MAX_TURNS = "100";
const PASS_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "CLAUDE_CODE_OAUTH_TOKEN"];

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

const [promptArg, model, capArg] = process.argv.slice(2);
const cap = Number(capArg);
if (!promptArg || !model || !(cap > 0)) refuse("usage: review.mjs <prompt-file> <model> <max-cost-usd>");
const promptFile = path.resolve(TASK, promptArg);
if (!existsSync(promptFile)) refuse(`no prompt file ${promptFile}`);
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) refuse("needs CLAUDE_CODE_OAUTH_TOKEN");

const work = process.cwd();
for (const f of ["repo.bundle", "pr.json"]) if (!existsSync(path.join(work, f))) refuse(`fixture missing ${f} in ${work}`);
const pr = JSON.parse(readFileSync(path.join(work, "pr.json"), "utf-8"));

const scratch = mkdtempSync(path.join(os.tmpdir(), "me-review-"));
const repo = path.join(scratch, "mon-entreprise");
const bin = path.join(scratch, "bin");
const findingsFile = path.join(scratch, "findings.jsonl");
const ghLog = path.join(scratch, "gh-calls.jsonl");
const prJson = path.join(scratch, "pr.json");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });

run("git", ["init", "-q", repo]);
const ref = run("git", ["bundle", "list-heads", path.join(work, "repo.bundle")]).trim().split(/\s+/)[1];
// Detached at the PR head, as actions/checkout leaves it.
run("git", ["fetch", "-q", path.join(work, "repo.bundle"), ref], repo);
run("git", ["checkout", "-q", "--detach", "FETCH_HEAD"], repo);
run("git", ["update-ref", `refs/remotes/origin/${pr.baseRefName}`, pr.baseSha], repo);
cpSync(path.join(TASK, "agents", "bin"), bin, { recursive: true });
cpSync(path.join(work, "pr.json"), prJson);

const prompt = [
  `REPO: ${pr.repo}`,
  `PR NUMBER: ${pr.number}`,
  `COMMIT: ${pr.headSha}`,
  `BASE BRANCH: ${pr.baseRefName}`,
  "FORK: false",
  "",
  readFileSync(promptFile, "utf-8"),
].join("\n");

const allowed = [
  `Bash(gh pr comment ${pr.number}:*)`, "Bash(gh pr diff:*)", "Bash(gh pr view:*)", "Bash(gh pr checks:*)",
  "Bash(gh run view:*)", "Bash(gh api --method GET:*)", `Bash(gh api --method POST repos/${pr.repo}/pulls/${pr.number}/comments:*)`,
  "Bash(git log:*)", "Bash(git diff:*)", "Bash(git show:*)",
].join(",");

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => PASS_ENV.includes(k))),
  // No PATH entry inside this repo (npx adds node_modules/.bin): it would point the reviewer at the task.
  PATH: [bin, ...String(process.env.PATH).split(":").filter((d) => d && !d.startsWith(REPO_ROOT))].join(":"),
  CLAUDE_CONFIG_DIR: path.join(scratch, "claude"),
  REVIEW_PR_JSON: prJson,
  REVIEW_FINDINGS: findingsFile,
  REVIEW_GH_LOG: ghLog,
  REVIEW_REPO_DIR: repo,
};

const args = [
  "-p", prompt,
  "--model", model,
  "--max-turns", MAX_TURNS,
  "--max-budget-usd", String(cap),
  "--output-format", "stream-json", "--verbose",
  "--allowedTools", allowed,
  "--disallowedTools", "Edit,Write,NotebookEdit,WebFetch,WebSearch,Task",
  "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
];

const trace = createWriteStream(path.join(work, ".eval-trace.jsonl"));
const child = spawn("claude", args, { cwd: repo, env, stdio: ["ignore", "pipe", "inherit"] });
let tail = "";
child.stdout.on("data", (chunk) => {
  trace.write(chunk);
  tail = (tail + chunk.toString()).slice(-50000);
});
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** A posted comment as a finding; GitHub's `line` is the last line of a multi-line comment. */
function toFinding(comment) {
  const message = String(comment.body ?? "").trim();
  if (comment.kind === "reply" || message === "") return null;
  if (comment.kind !== "inline" || !comment.path) return { message };
  if (!comment.line) return { file: comment.path, message };
  return { file: comment.path, start_line: comment.start_line ?? comment.line, end_line: comment.line, message };
}

child.on("close", (code) => {
  trace.end();
  const line = tail.split("\n").reverse().find((l) => l.includes('"type":"result"'));
  let result = {};
  try {
    result = line ? JSON.parse(line) : {};
  } catch {
    // cut-off line: report what we have
  }
  const calls = readJsonl(ghLog);
  const posted = readJsonl(findingsFile);
  const out = {
    pr: pr.number,
    findings: posted,
    gh: { calls: calls.length, refused: calls.filter((c) => c.refused).map((c) => `${c.argv.slice(0, 4).join(" ")}: ${c.refused}`) },
    result: { subtype: result.subtype ?? "no result", turns: result.num_turns ?? null, cost_usd: result.total_cost_usd ?? null,
      final_text: String(result.result ?? "").slice(0, 2000) },
  };
  rmSync(scratch, { recursive: true, force: true });
  for (const f of ["repo.bundle", "pr.json"]) rmSync(path.join(work, f), { force: true });
  const text = JSON.stringify(out, null, 1);
  // No result line means the reviewer never finished: leave no findings.json, so the trial reads "no review".
  if (line) writeFileSync(path.join(work, "findings.json"), JSON.stringify(posted.map(toFinding).filter(Boolean), null, 1) + "\n");
  writeFileSync(path.join(work, "review.json"), text + "\n");
  console.log(text);
  process.exit(code === 0 && result.is_error !== true ? 0 : 1);
});
