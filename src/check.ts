/**
 * Objective code check — writes parsed files into a work dir, drops the
 * scaffold's `tsconfig.json` next to them, and runs `tsc --noEmit`.
 *
 * The work dir lives inside the repo tree (under `eval/results/<runId>/checks/`)
 * so Node's module resolution walks up to the repo-root `node_modules`
 * (react / zod / typescript already installed) — no extra install needed.
 *
 * Pure node: imports nothing from `src/`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** Truncate captured compiler output so records / reports stay small. */
const MAX_OUTPUT_CHARS = 8_000;

export interface CheckFile {
  path: string;
  content: string;
}

export interface CheckResult {
  passed: boolean;
  exitCode: number;
  output: string;
}

/** Run `tsc --noEmit` on `files`, using the scaffold's tsconfig. */
export async function runCheck(params: {
  files: readonly CheckFile[];
  /** Absolute (or cwd-relative) dir holding `tsconfig.json`. */
  scaffoldDir: string;
  /** Dir to materialize files + tsconfig into and run the compiler from. */
  workDir: string;
}): Promise<CheckResult> {
  const { files, scaffoldDir, workDir } = params;

  await fs.mkdir(workDir, { recursive: true });

  // Write every parsed file, honoring nested paths (e.g. "shared/schema.ts").
  await Promise.all(
    files.map(async (f) => {
      const rel = f.path.replace(/^[/\\]+/, "");
      const dest = path.join(workDir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.content, "utf-8");
    }),
  );

  // Copy the scaffold tsconfig in so `-p tsconfig.json` resolves relative to
  // the work dir (its `include` globs pick up only the files we just wrote).
  const tsconfig = await fs.readFile(
    path.join(scaffoldDir, "tsconfig.json"),
    "utf-8",
  );
  await fs.writeFile(path.join(workDir, "tsconfig.json"), tsconfig, "utf-8");

  if (files.length === 0) {
    return {
      passed: false,
      exitCode: -1,
      output: "no source files parsed from model output — nothing to compile",
    };
  }

  return await runTsc(workDir);
}

/** Spawn `npx tsc --noEmit -p tsconfig.json`; resolve with exit code + output. */
function runTsc(workDir: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    execFile(
      "npx",
      ["tsc", "--noEmit", "-p", "tsconfig.json"],
      { cwd: workDir, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`
          .trim()
          .slice(0, MAX_OUTPUT_CHARS);
        // execFile passes an Error with a numeric `.code` on non-zero exit.
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ passed: exitCode === 0, exitCode, output });
      },
    );
  });
}
