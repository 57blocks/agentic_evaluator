/**
 * Run a local command in a clean work directory. The candidate is the command,
 * not a model id. Cost is unobserved (source "none").
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../canon/hash.js";
import { looksLikePath } from "../script-path.js";
import {
  AdapterError,
  type ArtifactFile,
  type CandidateAdapter,
  type CandidateRequest,
  type CandidateResult,
  type ExecutionContext,
} from "./types.js";

const INPUT_FILE = ".eval-input.txt";
const MAX_BUFFER = 2 * 1024 * 1024;
const SKIP_NAMES = new Set(["node_modules", INPUT_FILE]);

function subst(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/**
 * Resolve one argv entry against the task that declared it.
 *
 * A task owns its agent (`agents/run.mjs`), the same way it owns its rubric
 * and its checks, so the directory can be copied anywhere and still run.
 * A declared script that resolves nowhere throws: node would otherwise exit 1
 * with MODULE_NOT_FOUND, and that stack trace would be recorded as the
 * candidate's deliverable — a broken path billed as a graded attempt.
 */
async function resolveArg(arg: string, taskRoot: string | undefined): Promise<string> {
  if (path.isAbsolute(arg)) return arg;
  if (!looksLikePath(arg)) return arg;
  const candidate = path.resolve(taskRoot ?? process.cwd(), arg);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    throw new AdapterError(`declared script not found: ${arg} (looked in ${taskRoot ?? process.cwd()})`, {
      kind: "spawn",
      ms: 0,
    });
  }
}

async function collectFiles(root: string): Promise<ArtifactFile[]> {
  const out: ArtifactFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_NAMES.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      out.push({ path: rel, content: await fs.readFile(abs, "utf-8") });
    }
  }
  await walk(root);
  return out;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER, env }, (error, stdout, stderr) => {
      const ms = Date.now() - t0;
      const out = { stdout: stdout ?? "", stderr: stderr ?? "" };
      if (!error) {
        resolve({ ...out, exitCode: 0 });
        return;
      }
      const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
      if (e.killed) {
        reject(new AdapterError("candidate CLI timed out", { kind: "timeout", ms }));
        return;
      }
      if (typeof e.code === "number") {
        resolve({ ...out, exitCode: e.code });
        return;
      }
      if (e.code === "ENOENT") {
        reject(new AdapterError(`command not found: ${cmd}`, { kind: "spawn", ms }));
        return;
      }
      reject(new AdapterError(e.message, { kind: "unknown", ms }));
    });
  });
}

export const agentCliAdapter: CandidateAdapter = {
  id: "agent-cli",

  async execute(request: CandidateRequest, context: ExecutionContext): Promise<CandidateResult> {
    const cli = request.cli;
    if (!cli?.argv.length) {
      throw new Error(`agent-cli candidate "${request.candidateId}" has no cli.argv`);
    }
    const vars = { input: request.inputText, workdir: context.workDir };
    const raw = cli.argv.map((a) => subst(a, vars));
    const cmd = await resolveArg(raw[0], context.taskRoot);
    const args = await Promise.all(raw.slice(1).map((a) => resolveArg(a, context.taskRoot)));

    await fs.mkdir(context.workDir, { recursive: true });
    await fs.writeFile(path.join(context.workDir, INPUT_FILE), request.inputText, "utf-8");

    const model = request.model ?? cmd;
    const base = {
      model,
      promptSha: sha256(request.inputText),
      promptChars: request.inputText.length,
      context: context.traceContext,
    };
    context.emit?.({ type: "model.request", ...base });

    const t0 = Date.now();
    try {
      const ran = await runCommand(cmd, args, { cwd: context.workDir, timeoutMs: request.timeoutMs, env: cli.env });
      const artifacts = await collectFiles(context.workDir);
      const ms = Date.now() - t0;
      context.emit?.({ type: "model.response", ...base, ms });
      return {
        text: ran.stdout.trim() !== "" ? ran.stdout : ran.stderr,
        artifacts,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        costSource: "none",
        ms,
        provider: "local-cli",
        finishReason: ran.exitCode === 0 ? "stop" : `exit ${ran.exitCode}`,
      };
    } catch (err) {
      const ms = err instanceof AdapterError ? err.ms : Date.now() - t0;
      const kind = err instanceof AdapterError && err.kind === "timeout" ? "timeout" : "network";
      const message = err instanceof Error ? err.message : String(err);
      context.emit?.({ type: "model.error", ...base, ms, error: { kind, message } });
      throw err;
    }
  },
};
