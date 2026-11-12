/**
 * `agenteval calibrate <run> --labels FILE` — does the absolute judge's
 * score separate the answers a person called right from the ones they called
 * wrong? Reads the run and the labels; calls no model, writes nothing. The
 * measure is src/canon/judge-calibration.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { calibrateJudge, LabelError, type CalibrationRow } from "../../canon/judge-calibration.js";
import { loadLabels } from "../../core/labels-load.js";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { calibrateLines } from "../calibrate-lines.js";
import { exists, isWorkflowRun, resolveRunDir, stepRunDirs } from "../run-target.js";

export const CALIBRATE_HELP = `agenteval calibrate <run> --labels FILE [options]

  Does the absolute judge's 1–5 score separate the answers a person called
  right from the ones they called wrong? For the overall score and each
  judged dimension: the scores on each side, AUC (the chance a right answer
  outscores a wrong one; 0.5 is a coin) with a 95% interval resampled by
  input, and how many wrong answers still got the top score. Also says how
  often the labels overrule the required check — none means the labels are
  the check's verdicts. Calls no model, writes nothing.

  <run>               a run id, or a path to a run directory
  --labels FILE       JSONL, one answer per line:
                      {"candidate":"…","input":"…","label":"right"|"wrong"}
                      plus optional "trial" (required when a candidate ran an
                      input more than once), "group", "basis", "note"
  --step ID           the step, when the run is a workflow run
  --json              print the result as JSON
  --workspace DIR     workspace to look the run id up in`;

async function stepDir(runDir: string, step: string | undefined): Promise<string> {
  const isStep = !(await isWorkflowRun(runDir)) && (await exists(path.join(runDir, "manifest.json")));
  if (isStep) return runDir;
  const steps = await stepRunDirs(runDir);
  if (step === undefined) throw new UsageError(`${runDir} is a workflow run: pick the step with --step (${steps.map((d) => path.basename(d)).join(", ")})`);
  const hit = steps.find((d) => path.basename(d) === step);
  if (!hit) throw new UsageError(`no step ${step} in ${runDir} (steps: ${steps.map((d) => path.basename(d)).join(", ")})`);
  return hit;
}

async function readRows(dir: string): Promise<CalibrationRow[]> {
  const raw = await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8").catch(() => {
    throw new UsageError(`${dir} has no scores.jsonl: not a finished run`);
  });
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as CalibrationRow);
}

interface ManifestJudge {
  run_id?: string;
  step?: { id?: string };
  judge?: { model?: string; methods?: string[] };
  evaluators?: { rubric_sha256?: string };
}

export async function cmdCalibrate(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["workspace", "step", "json", "labels"]);
  const target = args.positional[0];
  if (target === undefined) throw new UsageError("which run? `agenteval calibrate <run> --labels FILE` (try `agenteval ls`)");
  const labelsFile = stringFlag(args.flags, "labels");
  if (labelsFile === undefined) throw new UsageError("--labels FILE is required: the answers a person called right or wrong");

  const wsDir = stringFlag(args.flags, "workspace");
  const ws = wsDir ? workspaceAt(wsDir) : await findWorkspace();
  const dir = await stepDir(await resolveRunDir(ws, target), stringFlag(args.flags, "step"));
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf-8")) as ManifestJudge;
  if (manifest.judge?.methods && !manifest.judge.methods.includes("absolute-1-5")) {
    throw new UsageError(`this run's judge ran ${manifest.judge.methods.join(", ") || "no method"}, not absolute-1-5: there are no 1–5 scores to calibrate`);
  }

  let result;
  try {
    result = calibrateJudge(await loadLabels(labelsFile), await readRows(dir));
  } catch (err) {
    if (err instanceof LabelError) throw new UsageError(err.message);
    throw err;
  }

  if (args.flags.json) {
    io.out(`${JSON.stringify(result, null, 2)}\n`);
    return EXIT.ok;
  }
  const lines = calibrateLines(result, {
    run: manifest.run_id ?? path.basename(dir),
    step: manifest.step?.id ?? path.basename(dir),
    labelsFile,
    judge: manifest.judge?.model ?? null,
    rubric: manifest.evaluators?.rubric_sha256?.slice(0, 12) ?? null,
  });
  io.out(`${lines.join("\n")}\n`);
  return EXIT.ok;
}
