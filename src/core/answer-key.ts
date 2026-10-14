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
 * This keeps out an agent that goes looking, not one set on breaking out:
 * running candidates in a container (`cli.image`) is the real boundary.
 */

import { chmodSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const READABLE = 0o755;
const copies = new Map<string, string>();

function referencesOf(taskRoot: string): string {
  return path.join(path.resolve(taskRoot), "references");
}

/** The private copy a check may read during a run, or null. */
export function referencesCopyFor(taskRoot: string): string | null {
  return copies.get(path.resolve(taskRoot)) ?? null;
}

/** Undo a hide that a killed run never undid. */
export function restoreAnswerKey(taskRoot: string): boolean {
  const refs = referencesOf(taskRoot);
  try {
    if ((statSync(refs).mode & 0o777) !== 0) return false;
    chmodSync(refs, READABLE);
    return true;
  } catch {
    return false;
  }
}

export interface HiddenAnswerKey {
  /** Put it back. Safe to call twice. */
  restore(): Promise<void>;
}

export async function hideAnswerKey(taskRoot: string): Promise<HiddenAnswerKey> {
  const root = path.resolve(taskRoot);
  const refs = referencesOf(root);
  restoreAnswerKey(root);
  const stat = await fs.stat(refs).catch(() => null);
  if (!stat?.isDirectory()) return { restore: async () => {} };

  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "agenteval-references-"));
  await fs.cp(refs, copy, { recursive: true });
  const mode = stat.mode & 0o777;
  let restored = false;
  const putBack = (): void => {
    if (restored) return;
    restored = true;
    copies.delete(root);
    try {
      chmodSync(refs, mode);
    } catch {
      // Gone or moved: nothing to put back.
    }
  };
  // Ctrl+C ends the process through process.exit (src/proc.ts), which runs this.
  process.once("exit", putBack);
  copies.set(root, copy);
  await fs.chmod(refs, 0);

  return {
    async restore() {
      putBack();
      process.removeListener("exit", putBack);
      await fs.rm(copy, { recursive: true, force: true });
    },
  };
}
