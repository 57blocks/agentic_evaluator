/**
 * Probing a step's required check before anything is paid: an empty answer
 * must not pass, and each reference answer (`references/<input>`) must.
 *
 * The check is called exactly as a real trial calls it (generate.ts), with
 * the same files / output / input / meta contract, in a work dir under the
 * task's `runs/` so a check that resolves `node_modules` up the tree finds
 * them the same way. Nothing here calls a model.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCheck, runCommandCheck, type CheckFile, type CheckResult } from "../check.js";
import { resolveTaskAsset } from "../paths.js";
import type { Suite } from "../types.js";
import type { Finding } from "./preflight.js";

/** What a probe hands the check: the deliverable as files and as text. */
interface Answer {
  files: CheckFile[];
  output: string;
}

const EMPTY: Answer = { files: [], output: "" };

async function runStepCheck(suite: Suite, input: { slug: string; text: string }, answer: Answer, workDir: string): Promise<CheckResult> {
  const check = suite.check!;
  if (check.kind === "tsc") {
    return runCheck({ files: answer.files, scaffoldDir: await resolveTaskAsset(suite.taskRoot, check.scaffoldDir), workDir });
  }
  return runCommandCheck({
    argv: check.argv,
    versionFiles: check.versionFiles,
    taskRoot: suite.taskRoot,
    timeoutMs: check.timeoutMs,
    files: answer.files,
    output: answer.output,
    input: input.text,
    meta: { step: suite.step, candidate: "check-task", input: input.slug, trial: 0 },
    workDir,
  });
}

async function filesUnder(root: string): Promise<CheckFile[]> {
  const out: CheckFile[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    out.push({ path: path.relative(root, abs).split(path.sep).join("/"), content: await fs.readFile(abs, "utf-8") });
  }
  return out;
}

/**
 * `references/<slug>/` holds the files a correct candidate leaves behind (an
 * `output.txt` among them is the deliverable text); `references/<slug>.txt`
 * is the deliverable text alone. Null when the input has no reference.
 */
async function referenceFor(taskRoot: string, slug: string): Promise<Answer | null> {
  const dir = path.join(taskRoot, "references", slug);
  if (await fs.stat(dir).then((s) => s.isDirectory(), () => false)) {
    const files = await filesUnder(dir);
    return { files, output: files.find((f) => f.path === "output.txt")?.content ?? "" };
  }
  const text = await fs.readFile(path.join(taskRoot, "references", `${slug}.txt`), "utf-8").catch(() => null);
  return text === null ? null : { files: [], output: text };
}

const describe = (r: CheckResult): string => `${r.state}${r.reason ? ` (${r.reason})` : ""}`;

/** The null probe: an empty answer must fail (or be not_evaluated); passing or crashing blocks. */
async function nullProbe(suite: Suite, inputs: readonly { slug: string; text: string }[], scratch: string): Promise<Finding> {
  const passed: string[] = [];
  const crashed: string[] = [];
  for (const input of inputs) {
    const r = await runStepCheck(suite, input, EMPTY, path.join(scratch, `null__${input.slug}`));
    if (r.state === "pass") passed.push(input.slug);
    if (r.state === "evaluator_error") crashed.push(`${input.slug}: ${describe(r)}`);
  }
  const id = suite.check!.id;
  if (passed.length > 0) {
    return { severity: "blocking", code: "check.null", message: `${id} passes an empty answer (${passed.join(", ")}): it cannot tell a candidate that did nothing from one that did the task` };
  }
  if (crashed.length > 0) {
    return { severity: "blocking", code: "check.null", message: `${id} cannot grade an empty answer — evaluator_error, so a candidate that produces nothing goes undetermined instead of failing: ${crashed.join("; ")}` };
  }
  return { severity: "ok", code: "check.null", message: `${id} fails an empty answer on ${inputs.length} input(s)` };
}

/** The oracle probe: every reference answer must pass. Inputs with none are listed as a warning. */
async function oracleProbe(suite: Suite, inputs: readonly { slug: string; text: string }[], scratch: string): Promise<Finding[]> {
  const id = suite.check!.id;
  const missing: string[] = [];
  const rejected: string[] = [];
  let passed = 0;
  for (const input of inputs) {
    const reference = await referenceFor(suite.taskRoot, input.slug);
    if (reference === null) {
      missing.push(input.slug);
      continue;
    }
    const r = await runStepCheck(suite, input, reference, path.join(scratch, `ref__${input.slug}`));
    if (r.state === "pass") passed += 1;
    else rejected.push(`${input.slug}: ${describe(r)}`);
  }
  const out: Finding[] = [];
  if (rejected.length > 0) {
    out.push({ severity: "blocking", code: "check.oracle", message: `${id} rejects the reference answer — either the check or the reference is wrong: ${rejected.join("; ")}` });
  } else if (passed > 0) {
    out.push({ severity: "ok", code: "check.oracle", message: `${id} passes the reference answer on ${passed} input(s)` });
  }
  if (missing.length > 0) {
    out.push({ severity: "warning", code: "check.no-reference", message: `no reference answer for ${missing.join(", ")} (references/<input>/ or references/<input>.txt): nothing confirms ${id} passes a correct answer` });
  }
  return out;
}

/** Both probes for one step, in a scratch dir under the task's runs/ that is removed afterwards. */
export async function probeCheck(
  suite: Suite,
  inputs: readonly { slug: string; text: string }[],
  opts: { keep?: boolean } = {},
): Promise<Finding[]> {
  const scratch = path.join(suite.taskRoot, "runs", `check-task-${Date.now()}-${process.pid}`);
  try {
    return [await nullProbe(suite, inputs, scratch), ...(await oracleProbe(suite, inputs, scratch))];
  } finally {
    if (!opts.keep) await fs.rm(scratch, { recursive: true, force: true });
  }
}
