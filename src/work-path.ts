/**
 * Where a candidate's file may be written: inside the work dir, never above it.
 *
 * A codegen model names its own files (`file:<path>`) and an agent's artifacts
 * are read back from wherever it put them. Either can say `../../.zshrc`.
 * Every place that writes such a path on the host resolves it here first.
 */

import path from "node:path";

/**
 * `rel` resolved under `base`, or null when it would land on or outside
 * `base`. A leading slash is stripped — a model that writes `/src/a.ts` means
 * the work dir's `src/a.ts` — and `..` is allowed only while it stays inside.
 */
export function resolveUnder(base: string, rel: string): string | null {
  const root = path.resolve(base);
  const dest = path.resolve(root, rel.replace(/^[/\\]+/, ""));
  return dest.startsWith(root + path.sep) ? dest : null;
}
