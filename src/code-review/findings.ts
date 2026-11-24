/**
 * The code-review contract (docs/design/code-review.md): what a reviewer
 * under test leaves (`findings.json`) and what a dataset item expects
 * (items.jsonl `expected`, written to references/<input>.txt).
 *
 *   finding   {file?, start_line?, end_line?, category?, severity?, message,
 *              blocking?, producer?}   — no file: a PR-level finding
 *   expected  {kind: "defect", source?, defects: [{file, start_line, end_line?,
 *              category?, severity?, description, fix_commit?, fix_diff?, knowable?}]}
 *             | {kind: "clean", note?}
 *
 * Line numbers are in the PR head version of the file. Pure: no fs.
 */


export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  /** Absent: a PR-level finding. */
  file?: string;
  start_line?: number;
  /** Defaults to start_line. */
  end_line?: number;
  category?: string;
  severity?: Severity;
  message: string;
  blocking?: boolean;
  /** Which reviewer agent produced it. */
  producer?: string;
}

export interface Defect {
  file: string;
  start_line: number;
  end_line: number;
  category?: string;
  severity?: string;
  description: string;
  fix_commit?: string;
  fix_diff?: string;
  /** Whether a reviewer could have known from the PR alone; absent when nobody said. */
  knowable?: boolean;
}

export type Expected =
  | { kind: "defect"; source?: string; defects: Defect[] }
  | { kind: "clean"; note?: string };

/** A finding the contract does not accept: which one (1-based) and why. */
export interface InvalidFinding {
  index: number;
  why: string;
}

export type ParsedFindings =
  | { ok: true; findings: Finding[]; invalid: InvalidFinding[] }
  | { ok: false; why: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLine = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
/** JSON null and an absent key mean the same thing here. */
const given = (v: unknown): boolean => v !== undefined && v !== null;

/** NFC, forward slashes kept as written, no leading `./`: how a finding's file and a defect's are compared. */
export function normalizePath(p: string): string {
  let out = p.trim().normalize("NFC");
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/** One finding, or why it is not one. Unknown keys are ignored. */
export function validateFinding(raw: unknown): Finding | string {
  if (!isRecord(raw)) return "not an object";
  const { file, start_line, end_line, category, severity, message, blocking, producer } = raw;
  if (typeof message !== "string" || message.trim() === "") return "message is missing or empty";
  if (given(file) && (typeof file !== "string" || file.trim() === "")) return "file is not a non-empty string";
  if (given(start_line) && !isLine(start_line)) return "start_line is not a positive integer";
  if (given(end_line) && !isLine(end_line)) return "end_line is not a positive integer";
  if (given(end_line) && !given(start_line)) return "end_line without start_line";
  if (given(start_line) && !given(file)) return "start_line without file";
  if (isLine(start_line) && isLine(end_line) && end_line < start_line) return "end_line is before start_line";
  if (given(category) && typeof category !== "string") return "category is not a string";
  const sev = typeof severity === "string" ? severity.toLowerCase() : severity;
  if (given(severity) && !(SEVERITIES as readonly unknown[]).includes(sev)) return `severity is not one of ${SEVERITIES.join("|")}`;
  if (given(blocking) && typeof blocking !== "boolean") return "blocking is not a boolean";
  if (given(producer) && typeof producer !== "string") return "producer is not a string";
  return {
    ...(given(file) ? { file: file as string } : {}),
    ...(given(start_line) ? { start_line: start_line as number, end_line: (given(end_line) ? end_line : start_line) as number } : {}),
    ...(given(category) && (category as string).trim() !== "" ? { category: category as string } : {}),
    ...(given(severity) ? { severity: sev as Severity } : {}),
    message: message as string,
    ...(given(blocking) ? { blocking: blocking as boolean } : {}),
    ...(given(producer) ? { producer: producer as string } : {}),
  };
}

/** `findings.json`'s text: an array of findings or `{"findings": [...]}`; invalid findings are dropped and listed. */
export function parseFindings(text: string): ParsedFindings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, why: `findings.json is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.findings) ? raw.findings : null;
  if (list === null) return { ok: false, why: 'findings.json must be an array of findings or {"findings": [...]}' };
  const findings: Finding[] = [];
  const invalid: InvalidFinding[] = [];
  list.forEach((item, i) => {
    const v = validateFinding(item);
    if (typeof v === "string") invalid.push({ index: i + 1, why: v });
    else findings.push(v);
  });
  return { ok: true, findings, invalid };
}

export class ExpectedError extends Error {}

function parseDefect(raw: unknown, i: number): Defect {
  const where = `defects[${i}]`;
  if (!isRecord(raw)) throw new ExpectedError(`${where} is not an object`);
  const { file, start_line, end_line, category, severity, description, fix_commit, fix_diff, knowable } = raw;
  if (given(knowable) && typeof knowable !== "boolean") throw new ExpectedError(`${where}.knowable is not true or false`);
  if (typeof file !== "string" || file.trim() === "") throw new ExpectedError(`${where}.file is missing`);
  if (!isLine(start_line)) throw new ExpectedError(`${where}.start_line is not a positive integer`);
  if (given(end_line) && (!isLine(end_line) || end_line < start_line)) throw new ExpectedError(`${where}.end_line is not a line at or after start_line`);
  if (typeof description !== "string" || description.trim() === "") throw new ExpectedError(`${where}.description is missing`);
  const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
  return {
    file,
    start_line,
    end_line: given(end_line) ? (end_line as number) : start_line,
    ...(text(category) ? { category: text(category) } : {}),
    ...(text(severity) ? { severity: text(severity) } : {}),
    description,
    ...(text(fix_commit) ? { fix_commit: text(fix_commit) } : {}),
    ...(text(fix_diff) ? { fix_diff: text(fix_diff) } : {}),
    ...(typeof knowable === "boolean" ? { knowable } : {}),
  };
}

/** An item's answer key, as references/<input>.txt holds it. Throws ExpectedError when it is not one. */
export function parseExpected(text: string): Expected {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ExpectedError(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!isRecord(raw)) throw new ExpectedError("not a JSON object");
  if (raw.kind === "clean") return { kind: "clean", ...(typeof raw.note === "string" ? { note: raw.note } : {}) };
  if (raw.kind !== "defect") throw new ExpectedError(`kind must be "defect" or "clean", not ${JSON.stringify(raw.kind)}`);
  if (!Array.isArray(raw.defects) || raw.defects.length === 0) throw new ExpectedError("a defect item needs a non-empty defects list");
  return {
    kind: "defect",
    ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    defects: raw.defects.map(parseDefect),
  };
}

/**
 * The review a perfect reviewer would leave for this item: each known defect
 * as a blocking finding on its own lines; nothing on a clean item. This is
 * what `check-task`'s oracle probe hands the check as `findings.json`.
 */
export function oracleFindings(expected: Expected): Finding[] {
  if (expected.kind === "clean") return [];
  return expected.defects.map((d) => {
    const sev = d.severity?.toLowerCase();
    return {
      file: d.file,
      start_line: d.start_line,
      end_line: d.end_line,
      ...(d.category ? { category: d.category } : {}),
      ...((SEVERITIES as readonly string[]).includes(sev ?? "") ? { severity: sev as Severity } : {}),
      message: d.description,
      blocking: true,
    };
  });
}
