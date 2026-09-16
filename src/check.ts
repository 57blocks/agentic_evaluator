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
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import { sha256, short } from "./canon/hash.js";
import type { EvaluationState } from "./canon/types.js";

/** Truncate captured compiler output so records / reports stay small. */
const MAX_OUTPUT_CHARS = 8_000;
const TSC_TIMEOUT_MS = 120_000;

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

/** TypeScript version from the repo's installed package; "unknown" if absent. */
export async function tscVersion(): Promise<string> {
  if (cachedTscVersion) return cachedTscVersion;
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, "node_modules", "typescript", "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    cachedTscVersion = typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    cachedTscVersion = "unknown";
  }
  return cachedTscVersion;
}

export async function scaffoldSha(scaffoldDir: string): Promise<string> {
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

/** Spawn the repo's tsc via node (no npx: deterministic binary, no npm noise). */
function runTsc(workDir: string): Promise<Omit<CheckResult, "version">> {
  const tscJs = path.join(REPO_ROOT, "node_modules", "typescript", "lib", "tsc.js");
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
