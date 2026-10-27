/**
 * Reading a file the candidate wrote in its work dir (`.eval-usage.json`,
 * `.eval-trace.json`). The agent under evaluation owns that directory, so the
 * file is untrusted input: a symlink there could point the harness at the
 * answer key or any file on the host, and a huge file could stall the run.
 * Only a regular file under the cap is read; anything else is reported as
 * absent-with-a-reason, never followed.
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Past this a self-reported file is not read: the same cap as a deliverable's. */
export const MAX_WORK_FILE_BYTES = 2 * 1024 * 1024;

export type WorkFileRead = { text: string } | { refused: string } | null;

// O_NOFOLLOW is missing on Windows, where a symlink needs a privilege the
// agent is unlikely to have; the open then follows nothing special.
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/**
 * The file's text, why it was refused, or null when there is no such entry.
 *
 * Opened once without following a symlink, then checked and read through
 * that same handle: a process the agent left behind cannot swap the entry
 * between the check and the read. Reading stops one byte past the cap, so
 * a file still growing is refused, not read whole.
 */
export async function readWorkFile(workDir: string, name: string, maxBytes = MAX_WORK_FILE_BYTES): Promise<WorkFileRead> {
  const file = path.join(workDir, name);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, fs.constants.O_RDONLY | NO_FOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // ELOOP: the entry is a symlink and was not followed.
    return { refused: code === "ELOOP" ? `${name} is a symlink` : `${name} could not be opened` };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { refused: `${name} is not a regular file` };
    if (stat.size > maxBytes) return { refused: `${name} is ${stat.size} bytes, over ${maxBytes}` };
    const buffer = Buffer.alloc(maxBytes + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > maxBytes) return { refused: `${name} grew past ${maxBytes} bytes while being read` };
    return { text: buffer.subarray(0, filled).toString("utf-8") };
  } catch {
    return { refused: `${name} could not be read` };
  } finally {
    await handle.close();
  }
}
