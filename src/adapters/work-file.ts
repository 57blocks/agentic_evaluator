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

/** The file's text, why it was refused, or null when there is no such entry. */
export async function readWorkFile(workDir: string, name: string, maxBytes = MAX_WORK_FILE_BYTES): Promise<WorkFileRead> {
  const file = path.join(workDir, name);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return { refused: `${name} is not a regular file` };
  if (stat.size > maxBytes) return { refused: `${name} is ${stat.size} bytes, over ${maxBytes}` };
  try {
    return { text: await fs.readFile(file, "utf-8") };
  } catch {
    return { refused: `${name} could not be read` };
  }
}
