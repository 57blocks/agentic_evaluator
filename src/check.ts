/**
 * Objective code check — writes parsed files into a work dir, drops the
 * scaffold's `tsconfig.json` next to them, and runs the repo's own `tsc --noEmit`.
 *
 * Result carries a protocol evaluator state (required-check contract, §5):
 *   pass            → compiler exit 0
 *   fail            → compiler exit non-zero (type errors)
 *   not_evaluated   → nothing to compile (no files parsed from the model output)
 *   evaluator_error → the checker itself could not run (tsc missing, killed, …)
 * plus `passed` for the legacy report path. The implementation version is
 * `tsc-<typescript version>+scaffold-<sha8 of scaffold tsconfig>` so a change
 * in either invalidates comparisons.
 *
 * The work dir lives under the run dir inside the repo tree, so Node's module
 * resolution walks up to the repo-root `node_modules` (react / zod installed as
 * devDependencies) — no extra install needed. Not sandboxed; Docker is deferred.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveTaskAssetSync } from "./paths.js";
import { looksLikePath } from "./script-path.js";
import { sha256, short } from "./canon/hash.js";
import type { EvaluationState } from "./canon/types.js";

/** Truncate captured compiler output so records / reports stay small. */
const MAX_OUTPUT_CHARS = 8_000;
const TSC_TIMEOUT_MS = 120_000;

/**
 * Resolve typescript the way Node would, not from INSTALL_ROOT/node_modules:
 * an installed harness usually has its dependencies hoisted above it.
 */
const require = createRequire(import.meta.url);
function typescriptFile(rel: string): string {
  return path.join(path.dirname(require.resolve("typescript/package.json")), rel);
}

export const TSC_CHECK_ID = "tsc-noemit";

export interface CheckFile {
  path: string;
  content: string;
}

export interface CheckResult {
  state: EvaluationState;
  /** Legacy convenience: `state === "pass"`. */
  passed: boolean;
  exitCode: number;
  output: string;
  /** e.g. "tsc-6.0.2+scaffold-a1f3b2c4". */
  version: string;
  reason?: string;
}

let cachedTscVersion: string | undefined;

/** TypeScript version from the harness's own installed package; "unknown" if absent. */
async function tscVersion(): Promise<string> {
  if (cachedTscVersion) return cachedTscVersion;
  try {
    const raw = await fs.readFile(typescriptFile("package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedTscVersion = typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    cachedTscVersion = "unknown";
  }
  return cachedTscVersion;
}

async function scaffoldSha(scaffoldDir: string): Promise<string> {
  const tsconfig = await fs.readFile(path.join(scaffoldDir, "tsconfig.json"), "utf-8");
  return sha256(tsconfig);
}

export async function checkVersion(scaffoldDir: string): Promise<string> {
  const [ts, sc] = await Promise.all([tscVersion(), scaffoldSha(scaffoldDir)]);
  return `tsc-${ts}+scaffold-${short(sc)}`;
}

/** Run `tsc --noEmit` on `files`, using the scaffold's tsconfig. Never throws. */
export async function runCheck(params: {
  files: readonly CheckFile[];
  /** Absolute (or cwd-relative) dir holding `tsconfig.json`. */
  scaffoldDir: string;
  /** Dir to materialize files + tsconfig into and run the compiler from. */
  workDir: string;
}): Promise<CheckResult> {
  const { files, scaffoldDir, workDir } = params;
  const version = await checkVersion(scaffoldDir);

  if (files.length === 0) {
    return {
      state: "not_evaluated",
      passed: false,
      exitCode: -1,
      output: "no source files parsed from model output — nothing to compile",
      version,
      reason: "no files parsed",
    };
  }

  try {
    await fs.mkdir(workDir, { recursive: true });
    await Promise.all(
      files.map(async (f) => {
        const rel = f.path.replace(/^[/\\]+/, "");
        const dest = path.join(workDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.content, "utf-8");
      }),
    );
    const tsconfig = await fs.readFile(path.join(scaffoldDir, "tsconfig.json"), "utf-8");
    await fs.writeFile(path.join(workDir, "tsconfig.json"), tsconfig, "utf-8");
  } catch (err) {
    return {
      state: "evaluator_error",
      passed: false,
      exitCode: -1,
      output: err instanceof Error ? err.message : String(err),
      version,
      reason: "could not materialize work dir",
    };
  }

  const result = await runTsc(workDir);
  return { ...result, version };
}

/** Spawn the harness's own tsc via node (no npx: deterministic binary, no npm noise). */
function runTsc(workDir: string): Promise<Omit<CheckResult, "version">> {
  let tscJs: string;
  try {
    tscJs = typescriptFile(path.join("lib", "tsc.js"));
  } catch {
    return Promise.resolve({
      state: "evaluator_error",
      passed: false,
      exitCode: -1,
      output: "",
      reason: "typescript is not installed next to the harness",
    });
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [tscJs, "--noEmit", "-p", "tsconfig.json"],
      { cwd: workDir, timeout: TSC_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim().slice(0, MAX_OUTPUT_CHARS);
        if (!error) {
          resolve({ state: "pass", passed: true, exitCode: 0, output });
          return;
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        if (typeof e.code === "number") {
          // The compiler ran and reported diagnostics.
          resolve({ state: "fail", passed: false, exitCode: e.code, output });
          return;
        }
        const reason = e.killed ? "tsc timed out or was killed" : e.code === "ENOENT" ? "tsc not found" : e.message;
        resolve({ state: "evaluator_error", passed: false, exitCode: -1, output: output || reason, reason });
      },
    );
  });
}

/* ── command checks ─────────────────────────────────────────────────────────
 *
 * A declared program is how a step that is not codegen gets a deterministic
 * gate. The contract is deliberately small so a check can be a ten-line
 * script:
 *
 *   work dir     the trial's own directory, already holding the candidate's
 *                parsed artifacts (if any), plus:
 *                  output.txt  the deliverable text
 *                  input.txt   this test case's input
 *                  meta.json   { step, candidate, input, trial }
 *   cwd          the work dir
 *   exit 0       pass
 *   exit 1       fail — the candidate did not satisfy the check
 *   anything else, a spawn failure, or a timeout → evaluator_error, which is
 *                NEVER counted as a candidate failure (protocol §5)
 *   stdout       optional JSON {"evidence": "...", "reason": "..."}; plain
 *                text is kept verbatim as the evidence instead
 *
 * The command runs on this host with the caller's privileges. Until the
 * Docker sandbox lands, only declare checks you would run yourself.
 */

const COMMAND_EXIT_PASS = 0;
const COMMAND_EXIT_FAIL = 1;

/**
 * argv is written relative to the repo (`["node", "checks/x.mjs"]`) but the
 * command runs with cwd = the trial work dir, so those paths must be resolved
 * before spawning. A declared script that does not exist is an evaluator
 * error, caught here: node exits 1 for "cannot find module", which would
 * otherwise be indistinguishable from the check failing the candidate — and
 * that is exactly how a broken path once marked every candidate as failed.
 */
function resolveArgv(
  argv: readonly string[],
  taskRoot?: string,
): { argv: string[]; missing: string[] } {
  const missing: string[] = [];
  const resolved = argv.map((arg) => {
    if (path.isAbsolute(arg) || !looksLikePath(arg)) return arg;
    const abs = resolveTaskAssetSync(taskRoot, arg);
    if (existsSync(abs)) return abs;
    missing.push(arg);
    return arg;
  });
  return { argv: resolved, missing };
}

/** Version = the argv plus the contents of every declared version file. */
export async function commandCheckVersion(
  argv: readonly string[],
  versionFiles: readonly string[],
  taskRoot?: string,
): Promise<string> {
  const parts = await Promise.all(
    [...versionFiles].sort().map(async (rel) => {
      const content = await fs
        .readFile(resolveTaskAssetSync(taskRoot, rel), "utf-8")
        .catch(() => "<missing>");
      return `${rel}:${sha256(content)}`;
    }),
  );
  return `cmd-${short(sha256(argv.join(" ")))}+files-${short(sha256(parts.join("\n")))}`;
}

/** Pull evidence out of the check's stdout, JSON or not. */
function evidenceOf(stdout: string): { evidence: string; reason?: string } {
  const text = stdout.trim();
  if (!text.startsWith("{")) return { evidence: text.slice(0, MAX_OUTPUT_CHARS) };
  try {
    const parsed = JSON.parse(text) as { evidence?: unknown; reason?: unknown };
    return {
      evidence: typeof parsed.evidence === "string" ? parsed.evidence.slice(0, MAX_OUTPUT_CHARS) : text.slice(0, MAX_OUTPUT_CHARS),
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return { evidence: text.slice(0, MAX_OUTPUT_CHARS) };
  }
}

export async function runCommandCheck(params: {
  argv: readonly string[];
  versionFiles: readonly string[];
  timeoutMs: number;
  files: readonly CheckFile[];
  /** The deliverable text, for checks that grade prose or JSON rather than files. */
  output: string;
  input: string;
  meta: { step: string; candidate: string; input: string; trial: number };
  workDir: string;
  /** Task dir the check's argv and version files resolve against. */
  taskRoot?: string;
}): Promise<CheckResult> {
  const taskRoot = params.taskRoot;
  const version = await commandCheckVersion(params.argv, params.versionFiles, taskRoot);
  try {
    await fs.mkdir(params.workDir, { recursive: true });
    await Promise.all([
      ...params.files.map(async (f) => {
        const dest = path.join(params.workDir, f.path.replace(/^[/\\]+/, ""));
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.content, "utf-8");
      }),
      fs.writeFile(path.join(params.workDir, "output.txt"), params.output, "utf-8"),
      fs.writeFile(path.join(params.workDir, "input.txt"), params.input, "utf-8"),
      fs.writeFile(path.join(params.workDir, "meta.json"), JSON.stringify(params.meta, null, 2), "utf-8"),
    ]);
  } catch (err) {
    return {
      state: "evaluator_error",
      passed: false,
      exitCode: -1,
      output: err instanceof Error ? err.message : String(err),
      version,
      reason: "could not materialize work dir",
    };
  }

  const { argv: resolvedArgv, missing } = resolveArgv(params.argv, taskRoot);
  if (missing.length > 0) {
    return {
      state: "evaluator_error",
      passed: false,
      exitCode: -1,
      output: `declared check path(s) not found under the repo: ${missing.join(", ")}`,
      version,
      reason: "check program not found",
    };
  }

  const [program, ...args] = resolvedArgv;
  return new Promise((resolve) => {
    execFile(
      program,
      args,
      { cwd: params.workDir, timeout: params.timeoutMs, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const { evidence, reason } = evidenceOf(`${stdout ?? ""}`);
        const errText = `${stderr ?? ""}`.trim().slice(0, MAX_OUTPUT_CHARS);
        if (!error) {
          resolve({ state: "pass", passed: true, exitCode: COMMAND_EXIT_PASS, output: evidence, version, ...(reason ? { reason } : {}) });
          return;
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        if (typeof e.code === "number" && e.code === COMMAND_EXIT_FAIL) {
          resolve({
            state: "fail",
            passed: false,
            exitCode: COMMAND_EXIT_FAIL,
            output: evidence || errText,
            version,
            ...(reason ? { reason } : {}),
          });
          return;
        }
        const why = e.killed
          ? `check timed out after ${params.timeoutMs}ms`
          : e.code === "ENOENT"
            ? `check program not found: ${program}`
            : `check exited with ${String(e.code)}`;
        resolve({
          state: "evaluator_error",
          passed: false,
          exitCode: typeof e.code === "number" ? e.code : -1,
          output: errText || evidence || why,
          version,
          reason: why,
        });
      },
    );
  });
}
