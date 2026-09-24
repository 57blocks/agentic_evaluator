/**
 * Which of a task's definition files each step uses, and for what.
 *
 * Read from what the compiled spec references — inputs, prompt, rubric, the
 * required check's program and version files, a tsc scaffold, an agent's
 * command — never guessed from directory names. Pure: it is given the file
 * list the catalog already walked, and touches no disk.
 */

import path from "node:path";
import type { Suite } from "../types.js";

export type FileRole = "input" | "prompt" | "rubric" | "check" | "scaffold" | "agent";

export interface RoleFile {
  path: string;
  role: FileRole;
}

export interface StepFiles {
  id: string;
  files: RoleFile[];
}

export interface DefinitionFiles {
  /** The spec itself, when it is among the files. */
  spec: string | null;
  steps: StepFiles[];
  /** Files no step references — READMEs, reference solutions, unused inputs. */
  other: string[];
}

const SPEC_FILE = "spec.yaml";

/** Reading order inside a step: what goes in, how it is asked, how it is judged, what runs. */
const ROLE_ORDER: readonly FileRole[] = ["input", "prompt", "rubric", "check", "scaffold", "agent"];

function normalise(rel: string): string {
  return path.posix.normalize(rel.split(path.sep).join("/")).replace(/^\.\//, "");
}

/** argv words that name one of the task's files; `node`, `--mode`, `fail` are not. */
function filesIn(argv: readonly string[] | undefined, known: ReadonlySet<string>): string[] {
  return (argv ?? []).map(normalise).filter((word) => known.has(word));
}

function referencesOf(suite: Suite, files: readonly string[], known: ReadonlySet<string>): RoleFile[] {
  const refs: RoleFile[] = [];
  const add = (role: FileRole, rel: string | undefined): void => {
    if (rel === undefined) return;
    const p = normalise(rel);
    if (known.has(p)) refs.push({ path: p, role });
  };

  for (const slug of suite.inputs) add("input", `inputs/${slug}.txt`);
  // A codegen or agent step inherits x-harness.prompt_file but never reads it.
  if ((suite.producer ?? "prompt") === "prompt") add("prompt", suite.promptFile);
  add("rubric", suite.rubricFile);

  const check = suite.check;
  if (check?.kind === "command") {
    for (const p of [...filesIn(check.argv, known), ...check.versionFiles]) add("check", p);
  } else if (check?.kind === "tsc") {
    const dir = `${normalise(check.scaffoldDir)}/`;
    for (const p of files) if (p.startsWith(dir)) add("scaffold", p);
  }

  for (const def of Object.values(suite.candidateDefs ?? {})) {
    for (const p of filesIn(def.cli?.argv, known)) add("agent", p);
  }
  return refs;
}

function orderedUnique(refs: readonly RoleFile[]): RoleFile[] {
  const seen = new Set<string>();
  const unique = refs.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
  return unique
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.r.role) - ROLE_ORDER.indexOf(b.r.role) || a.i - b.i)
    .map(({ r }) => r);
}

export function attributeFiles(suites: readonly Suite[], files: readonly string[]): DefinitionFiles {
  const normalised = files.map(normalise);
  const known = new Set(normalised);
  const steps = suites.map((suite) => ({ id: suite.step, files: orderedUnique(referencesOf(suite, normalised, known)) }));
  const claimed = new Set(steps.flatMap((s) => s.files.map((f) => f.path)));
  return {
    spec: known.has(SPEC_FILE) ? SPEC_FILE : null,
    steps,
    other: normalised.filter((p) => p !== SPEC_FILE && !claimed.has(p)),
  };
}
