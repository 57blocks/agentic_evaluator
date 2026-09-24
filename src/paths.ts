/**
 * Installation paths — where the harness's own code lives.
 *
 * Resolved from this file's location, never from `process.cwd()`, so the tool
 * finds its own `node_modules`, its own `package.json` and its own built
 * assets no matter which directory it was launched from.
 *
 * This is deliberately **not** where the user's work lives. A task, its
 * inputs, its checks and its runs belong to a *workspace* — see
 * `src/core/workspace.ts`. The two used to be one constant called
 * `REPO_ROOT`, which is why the harness could only evaluate tasks vendored
 * into its own checkout.
 *
 * Install-rooted (here): the TypeScript compiler a `tsc` check spawns, the
 * harness version and commit a manifest records, the built demo assets, the
 * fixtures shipped as samples.
 * Workspace-rooted (there): `tasks/`, `runs/`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the installed harness — the directory holding its package.json. */
export const INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Committed sample runs, shipped with the harness. */
export function fixturesDir(): string {
  return path.join(INSTALL_ROOT, "fixtures");
}

/**
 * Resolve an asset a spec refers to (rubric, scaffold, check script).
 *
 * Always inside the task. A missing file resolves to where it should have
 * been rather than to a shared copy elsewhere: silently grading against a
 * file the task does not own is how two runs of "the same" task end up
 * judged by different rubrics.
 */
export async function resolveTaskAsset(taskRoot: string, p: string): Promise<string> {
  return resolveTaskAssetSync(taskRoot, p);
}

/** Sync twin of `resolveTaskAsset`, for the argv resolution in `check.ts`. */
export function resolveTaskAssetSync(taskRoot: string, p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(taskRoot, p);
}

/** Input text lives with its task: `<task>/inputs/<slug>.txt`. */
export function taskInputPath(taskRoot: string, slug: string): string {
  return path.join(taskRoot, "inputs", `${slug}.txt`);
}

/** Display a path the way a CLI should: relative to where the user is standing. */
export function displayPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return rel === "" ? "." : rel.startsWith("..") ? abs : rel;
}
