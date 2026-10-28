/**
 * Run a candidate's command in a clean work directory. The candidate is the
 * command, not a model id. Cost is unobserved (source "none") unless the
 * spec declares `reports_usage` and the command leaves `.eval-usage.json`
 * (see reported-usage.ts).
 *
 * With `cli.image` the command runs under `docker run` with only the work dir
 * mounted; without it, it runs as this process. Every result records which,
 * so "this agent ran on the harness's own machine" is visible evidence
 * rather than an assumption a reader has to make.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../canon/hash.js";
import { runProcess, type SpawnError } from "../proc.js";
import { looksLikePath } from "../script-path.js";
import { CONTAINER_WORKDIR, runInDocker, TASK_MOUNT, type Mount } from "./docker.js";
import { readReportedTokens, readReportedUsage, UNOBSERVED, USAGE_FILE, type ReportedUsage } from "./reported-usage.js";
import { readTraceFile, TRACE_FILES } from "../traces/index.js";
import type { AgentTrace } from "../canon/agent-trace.js";
import { catalogPrice, costOf } from "../pricing.js";
import type { AgentCliConfig } from "../canon/types.js";
import {
  AdapterError,
  type ArtifactFile,
  type CandidateAdapter,
  type CandidateRequest,
  type CandidateResult,
  type ExecutionContext,
} from "./types.js";

const INPUT_FILE = ".eval-input.txt";
// Not the deliverable: installs, version control (an agent that commits leaves
// text objects in .git that would read back, and hand on, as a broken repo),
// and agenteval's own files.
const SKIP_NAMES = new Set(["node_modules", ".git", INPUT_FILE, USAGE_FILE, ...Object.values(TRACE_FILES)]);

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The `${NAME}`s a value refers to. */
export function envRefs(value: string): string[] {
  return [...value.matchAll(ENV_REF)].map((m) => m[1]!);
}

/**
 * `${NAME}` in `cli.env` from this process's environment (`.env.local`
 * included), at the moment the command starts: a spec names its secrets, and
 * neither it nor the run's records ever hold them. A missing variable is the
 * setup's fault, raised before the command runs.
 */
export function expandEnv(env: Record<string, string>): Record<string, string> {
  const missing = new Set<string>();
  const out = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      v.replace(ENV_REF, (_, name: string) => {
        const value = process.env[name];
        if (value === undefined) missing.add(name);
        return value ?? "";
      }),
    ]),
  );
  if (missing.size > 0) throw new AdapterError(`cli.env needs ${[...missing].join(", ")}, which is not set`, { kind: "spawn", ms: 0 });
  return out;
}

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
async function resolveArg(arg: string, taskRoot: string): Promise<string> {
  if (path.isAbsolute(arg)) return arg;
  if (!looksLikePath(arg)) return arg;
  const candidate = path.resolve(taskRoot, arg);
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    throw new AdapterError(`declared script not found: ${arg} (looked in ${taskRoot})`, {
      kind: "spawn",
      ms: 0,
    });
  }
}

/**
 * The same argv, for a container. A declared script (`agents/run.mjs`) is
 * checked against the task exactly as on the host, then rewritten to where
 * its top-level directory is mounted read-only (`/task/agents/run.mjs`).
 * Only directories the command names are mounted, so a candidate never sees
 * the task's `checks/` or `rubrics/` unless its own argv points there.
 */
async function containerArgv(raw: readonly string[], taskRoot: string): Promise<{ argv: string[]; mounts: Mount[] }> {
  const mounts = new Map<string, Mount>();
  const argv: string[] = [];
  for (const arg of raw) {
    if (path.isAbsolute(arg) || !looksLikePath(arg)) {
      argv.push(arg);
      continue;
    }
    const abs = await resolveArg(arg, taskRoot);
    const rel = path.relative(taskRoot, abs);
    if (rel.startsWith("..")) {
      throw new AdapterError(`declared script is outside the task and cannot be mounted: ${arg}`, { kind: "spawn", ms: 0 });
    }
    const [top] = rel.split(path.sep);
    mounts.set(top, { host: path.join(taskRoot, top), container: `${TASK_MOUNT}/${top}` });
    argv.push(`${TASK_MOUNT}/${rel.split(path.sep).join("/")}`);
  }
  return { argv, mounts: [...mounts.values()] };
}

/**
 * What the work dir holds before the command starts: a chained step's handoff
 * (the previous step's files) when there is one, else the input's fixture.
 * Never both — a handed-over project already started from its fixture.
 */
async function layStartingState(workDir: string, request: CandidateRequest): Promise<void> {
  if (request.seedFiles) {
    for (const f of request.seedFiles) {
      const dest = path.join(workDir, f.path.replace(/^[/\\]+/, ""));
      if (!dest.startsWith(workDir + path.sep)) throw new Error(`handoff file escapes the work dir: ${f.path}`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.content, "utf-8");
    }
    return;
  }
  if (request.fixtureDir) await fs.cp(request.fixtureDir, workDir, { recursive: true });
}

/**
 * The trace the command left, when the spec says it leaves one. A killed
 * command's trace ends where it was stopped, and says so.
 */
async function traceOf(cli: AgentCliConfig, workDir: string, killed: boolean): Promise<{ trace?: AgentTrace; traceError?: string }> {
  if (!cli.trace) return {};
  const read = await readTraceFile(workDir, cli.trace);
  if (read === null) return {};
  if ("error" in read) return { traceError: read.error };
  return { trace: killed ? { ...read.trace, ended: "killed" } : read.trace };
}

/**
 * A trace that totals the run's tokens and cost (claude's stream) is the
 * usage report, unless the spec declared one: `reports_usage` stays the
 * explicit word, and a declared file wins over the trace's totals.
 */
function usageFromTrace(cli: AgentCliConfig, reported: ReportedUsage & { cachedTokens?: number }, trace: AgentTrace | undefined): ReportedUsage & { cachedTokens?: number } {
  if (cli.reports_usage !== undefined || !trace?.usage) return reported;
  const u = trace.usage;
  return { promptTokens: u.prompt + u.cached, completionTokens: u.completion, cachedTokens: u.cached, costUsd: u.costUsd, costSource: "estimated" };
}

/** Past this a file is not read back: a deliverable is source and docs, not logs or dumps. */
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
/** How much of a file is sniffed for a NUL byte, which text never has. */
const BINARY_SNIFF_BYTES = 8192;

/**
 * The files an agent left, as text. A file too large to be a deliverable, or
 * binary (which would be mangled as UTF-8, and handed on mangled), is left
 * out and named in `skipped`, never silently.
 */
/**
 * What the run cost, by what the spec says the command reports: nothing
 * (unobserved), its own dollar figure, or its tokens, which agenteval prices
 * with the candidate's price or its model's catalog price.
 */
async function usageOf(
  cli: AgentCliConfig,
  request: CandidateRequest,
  workDir: string,
): Promise<ReportedUsage & { cachedTokens?: number }> {
  if (cli.reports_usage === true) return readReportedUsage(workDir);
  if (cli.reports_usage !== "tokens") return UNOBSERVED;
  const tokens = await readReportedTokens(workDir);
  if (!tokens) return UNOBSERVED;
  const counted = {
    promptTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
    completionTokens: tokens.output,
    cachedTokens: tokens.cacheRead,
  };
  const price = request.price ?? (request.model ? await catalogPrice(request.model) : null);
  // Tokens without a price are still worth keeping; the cost stays unobserved.
  if (!price) return { ...counted, costUsd: 0, costSource: "none" };
  return { ...counted, costUsd: costOf(tokens, price), costSource: "estimated" };
}

async function collectFiles(root: string): Promise<{ files: ArtifactFile[]; skipped: string[] }> {
  const files: ArtifactFile[] = [];
  const skipped: string[] = [];
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
      const { size } = await fs.stat(abs);
      if (size > MAX_ARTIFACT_BYTES) {
        skipped.push(`${rel} (${size} bytes, over ${MAX_ARTIFACT_BYTES})`);
        continue;
      }
      const bytes = await fs.readFile(abs);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        skipped.push(`${rel} (binary)`);
        continue;
      }
      files.push({ path: rel, content: bytes.toString("utf-8") });
    }
  }
  await walk(root);
  return { files, skipped };
}

async function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const t0 = Date.now();
  let ran;
  try {
    ran = await runProcess(cmd, args, { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs });
  } catch (err) {
    const e = err as SpawnError;
    if (e.code === "ENOENT") throw new AdapterError(`command not found: ${cmd}`, { kind: "spawn", ms: e.ms });
    throw new AdapterError(e.message, { kind: "unknown", ms: Date.now() - t0 });
  }
  // A timed-out agent's own account of where it was is the evidence of why.
  if (ran.timedOut) {
    throw new AdapterError("candidate CLI timed out", { kind: "timeout", ms: ran.ms, log: `${ran.stdout}${ran.stderr.trim() ? `\n--- stderr ---\n${ran.stderr}` : ""}` });
  }
  const note = ran.droppedBytes > 0 ? `[agenteval: the first ${ran.droppedBytes} bytes of output were dropped; the tail is kept]\n` : "";
  // A signal (not ours: we only signal on timeout) ends it without a code.
  return { stdout: ran.stdout, stderr: note + ran.stderr, exitCode: ran.exitCode ?? 128 };
}

export const agentCliAdapter: CandidateAdapter = {
  id: "agent-cli",

  async execute(request: CandidateRequest, context: ExecutionContext): Promise<CandidateResult> {
    const cli = request.cli;
    if (!cli?.argv.length) {
      throw new Error(`agent-cli candidate "${request.candidateId}" has no cli.argv`);
    }
    const inDocker = cli.image !== undefined;
    // Inside the container the work dir is mounted at a fixed path and host
    // paths mean nothing, so a declared script is rewritten to its read-only
    // mount instead of being resolved to a host path.
    const vars = {
      input: request.inputText,
      workdir: inDocker ? CONTAINER_WORKDIR : context.workDir,
      max_cost_usd: request.maxCostUsd !== undefined ? String(request.maxCostUsd) : "",
    };
    const raw = cli.argv.map((a) => subst(a, vars));
    const contained = inDocker ? await containerArgv(raw, context.taskRoot) : null;
    const [cmd, ...args] = contained
      ? contained.argv
      : await Promise.all(raw.map((a) => resolveArg(a, context.taskRoot)));

    await fs.mkdir(context.workDir, { recursive: true });
    await layStartingState(context.workDir, request);
    await fs.writeFile(path.join(context.workDir, INPUT_FILE), request.inputText, "utf-8");
    // Which step and input this is, and whether the work dir came from the
    // step before: one command can then serve every step of a workflow.
    // The spend cap and the model's price: an agent tool enforces a cap in
    // its own units (claude's assume its vendor's prices), so a wrapper may
    // need the price to convert. Absent when unknown.
    const price = request.price ?? (request.model ? await catalogPrice(request.model) : null);
    const env = {
      ...expandEnv(cli.env ?? {}),
      EVAL_STEP: request.stepId,
      EVAL_INPUT: request.inputId,
      EVAL_CHAINED: request.seedFiles ? "1" : "0",
      ...(request.maxCostUsd !== undefined ? { EVAL_MAX_COST_USD: String(request.maxCostUsd) } : {}),
      ...(price ? { EVAL_MODEL_PRICE: JSON.stringify(price) } : {}),
    };

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
      let ran;
      try {
        ran = inDocker
          ? await runInDocker({ ...cli, env }, [cmd, ...args], {
              workDir: context.workDir,
              timeoutMs: request.timeoutMs,
              mounts: contained?.mounts,
            })
          : await runCommand(cmd, args, {
              cwd: context.workDir,
              timeoutMs: request.timeoutMs,
              env,
            });
      } catch (err) {
        // A stopped command keeps what it had written: its usage file and
        // its trace are evidence of where it got to, read after the kill.
        if (!(err instanceof AdapterError) || err.kind !== "timeout") throw err;
        const [reported, traced] = await Promise.all([usageOf(cli, request, context.workDir), traceOf(cli, context.workDir, true)]);
        throw new AdapterError(err.message, { kind: err.kind, ms: err.ms, log: err.log, partial: { ...usageFromTrace(cli, reported, traced.trace), ...traced } });
      }
      const [{ files: artifacts, skipped }, reported, traced] = await Promise.all([
        collectFiles(context.workDir),
        usageOf(cli, request, context.workDir),
        traceOf(cli, context.workDir, false),
      ]);
      const usage = usageFromTrace(cli, reported, traced.trace);
      const ms = Date.now() - t0;
      context.emit?.({ type: "model.response", ...base, ms, ...(skipped.length > 0 ? { skippedFiles: skipped } : {}) });
      return {
        text: ran.stdout.trim() !== "" ? ran.stdout : ran.stderr,
        log: `${ran.stdout}${ran.stderr.trim() ? `\n--- stderr ---\n${ran.stderr}` : ""}`,
        artifacts,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        ...(usage.cachedTokens !== undefined ? { cachedTokens: usage.cachedTokens } : {}),
        costUsd: usage.costUsd,
        costSource: usage.costSource,
        ms,
        isolation: inDocker ? "docker" : "none",
        // Who served the model, when the trace says; else how the command ran.
        provider: traced.trace?.provider ?? (inDocker ? `docker:${cli.image}` : "local-cli"),
        finishReason: ran.exitCode === 0 ? "stop" : `exit ${ran.exitCode}`,
        ...traced,
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
