/**
 * Keep a task's answer key out of candidates' reach while a run is in flight
 * (docs/design/agb-flow-gaps.md A6).
 *
 * `references/` holds the correct answers; a command candidate runs as the
 * same user, on the same machine, and its argv points into the task dir. For
 * the run's duration the directory is made unreadable (mode 000), and checks,
 * which may grade against it, get a private copy through EVAL_REFERENCES_DIR —
 * an env var only checks are given. The mode is put back when the run ends,
 * however it ends; a run that was killed outright leaves it unreadable, and
 * the next run (or check-task) puts it back first.
 *
 * A task whose test set is an items file (src/core/items.ts) has its answers
 * in that file too, so it is made unreadable with references/ and put back
 * with it. Checks never need it: they read references/.
 *
 * This keeps out an agent that goes looking, not one set on breaking out:
 * running candidates in a container (`cli.image`) is the real boundary.
 */

import { chmodSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const READABLE = 0o755;
const READABLE_FILE = 0o644;
const copies = new Map<string, string>();

function referencesOf(taskRoot: string): string {
  return path.join(path.resolve(taskRoot), "references");
}

/** The private copy a check may read during a run, or null. */
export function referencesCopyFor(taskRoot: string): string | null {
  return copies.get(path.resolve(taskRoot)) ?? null;
}

/** Make a path readable again if a hide left it at mode 000; true when it did. */
function unhide(p: string, mode: number): boolean {
  try {
    if ((statSync(p).mode & 0o777) !== 0) return false;
    chmodSync(p, mode);
    return true;
  } catch {
    return false;
  }
}

/** Undo a hide that a killed run never undid: references/, and the task-relative items files given. */
export function restoreAnswerKey(taskRoot: string, itemsFiles: readonly string[] = []): boolean {
  const root = path.resolve(taskRoot);
  const results = [unhide(referencesOf(root), READABLE), ...itemsFiles.map((f) => unhide(path.resolve(root, f), READABLE_FILE))];
  return results.some(Boolean);
}

export interface HiddenAnswerKey {
  /** Put it back. Safe to call twice. */
  restore(): Promise<void>;
}

export async function hideAnswerKey(taskRoot: string, itemsFiles: readonly string[] = []): Promise<HiddenAnswerKey> {
  const root = path.resolve(taskRoot);
  const refs = referencesOf(root);
  restoreAnswerKey(root, itemsFiles);
  const refsStat = await fs.stat(refs).catch(() => null);
  const hasRefs = refsStat?.isDirectory() ?? false;
  // Each hidden path with the mode it goes back to.
  const hidden: Array<[string, number]> = hasRefs ? [[refs, refsStat!.mode & 0o777]] : [];
  for (const rel of itemsFiles) {
    const abs = path.resolve(root, rel);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat?.isFile()) hidden.push([abs, stat.mode & 0o777]);
  }
  if (hidden.length === 0) return { restore: async () => {} };

  const copy = hasRefs ? await fs.mkdtemp(path.join(os.tmpdir(), "agenteval-references-")) : null;
  if (copy) await fs.cp(refs, copy, { recursive: true });
  let restored = false;
  const putBack = (): void => {
    if (restored) return;
    restored = true;
    copies.delete(root);
    for (const [p, mode] of hidden) {
      try {
        chmodSync(p, mode);
      } catch {
        // Gone or moved: nothing to put back.
      }
    }
  };
  // Ctrl+C ends the process through process.exit (src/proc.ts), which runs this.
  process.once("exit", putBack);
  if (copy) copies.set(root, copy);
  for (const [p] of hidden) await fs.chmod(p, 0);

  return {
    async restore() {
      putBack();
      process.removeListener("exit", putBack);
      if (copy) await fs.rm(copy, { recursive: true, force: true });
    },
  };
}
