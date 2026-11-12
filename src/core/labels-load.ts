/**
 * A labels file for `agenteval calibrate`: JSONL, one answer per line.
 *
 *   {"candidate":"opus-5.5","input":"cd2-028","label":"right","group":"qualifying-stay","basis":"reviewed"}
 *
 * `candidate`, `input` and `label` ("right" or "wrong") are required; `trial`
 * is required when the run has several trials of that candidate on that
 * input. Anything malformed is refused with its line number: a label read
 * wrongly would quietly move the number this file exists to produce.
 */

import fs from "node:fs/promises";
import type { JudgeLabel } from "../canon/judge-calibration.js";
import { LabelError } from "../canon/judge-calibration.js";

const KNOWN = new Set(["candidate", "input", "trial", "label", "group", "basis", "note"]);

function optionalString(o: Record<string, unknown>, key: string, line: number): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new LabelError(`labels line ${line}: "${key}" must be a string`);
  return v;
}

export function parseLabel(text: string, line: number): JudgeLabel {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new LabelError(`labels line ${line} is not JSON`);
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) throw new LabelError(`labels line ${line} is not a JSON object`);
  const rec = o as Record<string, unknown>;
  const unknown = Object.keys(rec).filter((k) => !KNOWN.has(k));
  if (unknown.length > 0) throw new LabelError(`labels line ${line}: unknown field(s) ${unknown.join(", ")} (known: ${[...KNOWN].join(", ")})`);
  const candidate = optionalString(rec, "candidate", line);
  const input = optionalString(rec, "input", line);
  if (!candidate || !input) throw new LabelError(`labels line ${line}: "candidate" and "input" are required`);
  if (rec.label !== "right" && rec.label !== "wrong") throw new LabelError(`labels line ${line}: "label" must be "right" or "wrong"`);
  const trial = rec.trial;
  if (trial !== undefined && !(typeof trial === "number" && Number.isInteger(trial) && trial >= 0)) {
    throw new LabelError(`labels line ${line}: "trial" must be a whole number from 0`);
  }
  const group = optionalString(rec, "group", line);
  const basis = optionalString(rec, "basis", line);
  const note = optionalString(rec, "note", line);
  return {
    candidate,
    input,
    label: rec.label,
    line,
    ...(trial !== undefined ? { trial } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(basis !== undefined ? { basis } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

export async function loadLabels(file: string): Promise<JudgeLabel[]> {
  const raw = await fs.readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    throw new LabelError(err.code === "ENOENT" ? `no labels file ${file}` : `cannot read ${file}: ${err.message}`);
  });
  const labels = raw.split("\n").flatMap((text, i) => (text.trim() === "" ? [] : [parseLabel(text, i + 1)]));
  if (labels.length === 0) throw new LabelError(`${file} holds no labels`);
  return labels;
}
