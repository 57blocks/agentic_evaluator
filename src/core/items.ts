/**
 * `test_set.items_file`: a test set as one JSONL file, one line per input.
 *
 *   {"id":"q-001","input":"…","expected":{…},"tags":["ordinary"],"split":"dev"}
 *
 * The file is the source of truth. Loading a spec writes it out as the files
 * everything else already reads — `inputs/<id>.txt` and `references/<id>.txt`
 * — so checks, generation, review and the report do not change. Tags and
 * split ride on the Suite, so nothing re-reads the file while a run has it
 * hidden (answer-key.ts hides it with references/: it holds the answers).
 *
 * Serialization matches what the dataset generators have always written, so
 * a set moved onto an items file keeps its input hashes and `--reuse` keeps
 * its paid trials: a string becomes itself plus a newline, anything else
 * JSON indented by two plus a newline. `input_file` names a file whose bytes
 * are the input as they stand, for inputs too long to read inside a line.
 */

import { readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { InputLabels } from "../canon/about.js";

/** An input id becomes a file name: no separators, and neither `.` nor `..` (schema.ts PATH_SAFE). */
const ID_PATTERN = /^(?!\.\.?$)[^/\\]+$/;
const KNOWN_INPUT_KEYS = ["input", "input_file"] as const;

export interface TestItem {
  id: string;
  /** The input as written to inputs/<id>.txt. */
  input: string;
  /** The answer key as written to references/<id>.txt; absent when the line has none. */
  expected?: string;
  tags: string[];
  split?: string;
}

/** A line as parsed, before `input_file` is read. */
interface ParsedLine {
  id: string;
  input?: unknown;
  inputFile?: string;
  expected?: unknown;
  tags: string[];
  split?: string;
}

export class ItemsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemsError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Generator-compatible: a string plus a newline, anything else pretty JSON plus a newline. */
export function serializeItemValue(value: unknown): string {
  return typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`;
}

function parseLine(raw: unknown, where: string): ParsedLine {
  if (!isRecord(raw)) throw new ItemsError(`${where}: a line must be a JSON object`);
  const { id, tags, split } = raw;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new ItemsError(`${where}: "id" must be a string usable as a file name (no "/", "\\", "." or "..")`);
  }
  const given = KNOWN_INPUT_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null);
  if (given.length !== 1) throw new ItemsError(`${where} (${id}): give exactly one of "input" and "input_file"`);
  if (raw.input_file !== undefined && typeof raw.input_file !== "string") {
    throw new ItemsError(`${where} (${id}): "input_file" must be a path, relative to the task`);
  }
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) {
    throw new ItemsError(`${where} (${id}): "tags" must be an array of strings`);
  }
  if (split !== undefined && typeof split !== "string") throw new ItemsError(`${where} (${id}): "split" must be a string`);
  return {
    id,
    ...(raw.input_file !== undefined ? { inputFile: raw.input_file as string } : { input: raw.input }),
    ...(raw.expected !== undefined && raw.expected !== null ? { expected: raw.expected } : {}),
    tags: tags === undefined ? [] : [...(tags as string[])],
    ...(split !== undefined ? { split } : {}),
  };
}

/** Every line of an items file, validated; errors name the file and line. Other keys (provenance…) are ignored. */
export function parseItemsText(text: string, file: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Map<string, number>();
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `${file}:${i + 1}`;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new ItemsError(`${where}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    const item = parseLine(raw, where);
    const first = seen.get(item.id);
    if (first !== undefined) throw new ItemsError(`${where}: id "${item.id}" is already used on line ${first}`);
    seen.set(item.id, i + 1);
    out.push(item);
  });
  if (out.length === 0) throw new ItemsError(`${file}: no items`);
  return out;
}

/** A path the task owns: relative, and inside the task once resolved. */
function insideTask(taskRoot: string, rel: string, what: string): string {
  const abs = path.resolve(taskRoot, rel);
  const back = path.relative(taskRoot, abs);
  if (path.isAbsolute(rel) || back.startsWith("..") || path.isAbsolute(back)) {
    throw new ItemsError(`${what} "${rel}" must be a path inside the task`);
  }
  return abs;
}

/**
 * The file's text, remembered by size and mtime. A run hides the file
 * (mode 000) while candidates work; a spec loaded again in the same process
 * meanwhile (the dashboard's catalog) still sees it, because stat needs no
 * read permission.
 */
const cache = new Map<string, { size: number; mtimeMs: number; text: string }>();

function readItemsText(abs: string, rel: string): string {
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    throw new ItemsError(`items_file ${rel} not found`);
  }
  const hit = cache.get(abs);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.text;
  let text: string;
  try {
    text = readFileSync(abs, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES") {
      throw new ItemsError(
        `items_file ${rel} is unreadable: a run hides it while candidates work. If no run is in progress, \`agenteval check-task\` makes it readable again`,
      );
    }
    throw err;
  }
  cache.set(abs, { size: stat.size, mtimeMs: stat.mtimeMs, text });
  return text;
}

/** The task's items, each input read (inline or from its `input_file`) and serialized. */
export function readItems(taskRoot: string, itemsFile: string): TestItem[] {
  const abs = insideTask(taskRoot, itemsFile, "items_file");
  return parseItemsText(readItemsText(abs, itemsFile), itemsFile).map((line) => {
    let input: string;
    if (line.inputFile !== undefined) {
      const file = insideTask(taskRoot, line.inputFile, `${itemsFile} (${line.id}): input_file`);
      try {
        input = readFileSync(file, "utf-8");
      } catch {
        throw new ItemsError(`${itemsFile} (${line.id}): input_file ${line.inputFile} not found`);
      }
    } else {
      input = serializeItemValue(line.input);
    }
    return {
      id: line.id,
      input,
      ...(line.expected !== undefined ? { expected: serializeItemValue(line.expected) } : {}),
      tags: line.tags,
      ...(line.split !== undefined ? { split: line.split } : {}),
    };
  });
}

export function labelsOfItems(items: readonly TestItem[]): InputLabels {
  return Object.fromEntries(items.map((i) => [i.id, { tags: [...i.tags], ...(i.split !== undefined ? { split: i.split } : {}) }]));
}

/**
 * Write one file unless it already holds exactly this text. Returns whether a
 * file that held something else was replaced: the items file wins, and the
 * caller says so rather than overwrite in silence.
 */
async function writeIfChanged(abs: string, text: string): Promise<"same" | "created" | "replaced"> {
  const current = await fs.readFile(abs, "utf-8").catch(() => null);
  if (current === text) return "same";
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, "utf-8");
  return current === null ? "created" : "replaced";
}

/**
 * Write the items out where the engine and checks read them: inputs/<id>.txt
 * and references/<id>.txt. Returns the task-relative paths that held
 * different text before (hand edits the items file has just overwritten).
 */
export async function materializeItems(taskRoot: string, items: readonly TestItem[]): Promise<string[]> {
  const replaced: string[] = [];
  for (const item of items) {
    const targets: Array<[string, string]> = [[path.join("inputs", `${item.id}.txt`), item.input]];
    if (item.expected !== undefined) targets.push([path.join("references", `${item.id}.txt`), item.expected]);
    for (const [rel, text] of targets) {
      if ((await writeIfChanged(path.join(taskRoot, rel), text)) === "replaced") replaced.push(rel.split(path.sep).join("/"));
    }
  }
  return replaced;
}
