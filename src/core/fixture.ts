/**
 * Fixture inputs (`test_set.fixture_dir`): an input that is a project at a
 * moment in time, not only a text. `<fixture_dir>/<input>/` is laid into the
 * candidate's work dir before it starts; the check is told where it is.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { sha256 } from "../canon/hash.js";
import type { Suite } from "../types.js";

/** Absolute path of an input's fixture, or null when the step declares none. */
export function fixturePath(suite: Pick<Suite, "fixtureDir" | "taskRoot">, inputSlug: string): string | null {
  return suite.fixtureDir ? path.resolve(suite.taskRoot, suite.fixtureDir, inputSlug) : null;
}

export async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

/**
 * One hash for a fixture's contents: every file's path and bytes, in path
 * order. It joins the input text in the trial hash, so editing a fixture is a
 * different trial and `--reuse` never serves a stale generation.
 */
export async function fixtureSha(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
  const parts: string[] = [];
  for (const abs of files) {
    const bytes = createHash("sha256").update(await fs.readFile(abs)).digest("hex");
    parts.push(`${path.relative(dir, abs).split(path.sep).join("/")}\0${bytes}`);
  }
  return sha256(parts.join("\n"));
}

/** The input identity a trial hash covers: the text, plus the fixture when there is one. */
export async function inputIdentity(text: string, fixture: string | null): Promise<string> {
  return fixture ? `${text}\0fixture:${await fixtureSha(fixture)}` : text;
}
