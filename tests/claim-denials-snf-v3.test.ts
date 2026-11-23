/** tasks/claim-denials-snf-v3: a stratified, per-item-seeded, noisy rebuild of v2 whose keys still follow v2's rules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("datasets/tasks/claim-denials-snf-v3");
const gen = () => import(pathToFileURL(path.join(TASK, "gen", "generate.mjs")).href);
const CHECK = path.join(TASK, "checks", "triage-check.mjs");

type Item = {
  id: string;
  input: string;
  split: string;
  tags: string[];
  expected: Record<string, unknown> & {
    steps: { parse: Record<string, unknown>; records: { relevant: string[]; distractors: string[] }; facts: Record<string, string | null> };
  };
  metadata: { rule_family: string; difficulty: string; noise: string[]; seed: number };
};

const readJsonl = (file: string): Item[] =>
  fs.readFileSync(path.join(TASK, file), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
const dev = () => readJsonl("claim-denials-snf-v3.dev.jsonl");
const calibration = () => readJsonl("claim-denials-snf-v3.calibration.jsonl");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Every way the renderer may write an ISO date. */
function spellings(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  const mon = MONTHS[Number(m) - 1];
  return [iso, `${m}/${d}/${y}`, `${Number(m)}/${Number(d)}/${y}`, `${mon} ${Number(d)}, ${y}`, `${d}-${mon.toUpperCase()}-${y}`, iso.replaceAll("-", "")];
}
const shows = (text: string, iso: string) => spellings(iso).some((s) => text.includes(s));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A record line as it may appear: its words verbatim, each date in any spelling. */
const recordPattern = (line: string) =>
  new RegExp(line.split(/(\d{4}-\d{2}-\d{2})/).map((part, i) => (i % 2 ? `(?:${spellings(part).map(escape).join("|")})` : escape(part))).join(""));

test("the committed dev and calibration files are what the generator builds, byte for byte", async () => {
  const { buildSplit, SEED } = await gen();
  const jsonl = (items: unknown[]) => items.map((i) => JSON.stringify(i)).join("\n") + "\n";
  assert.equal(jsonl(buildSplit(SEED, "dev")), fs.readFileSync(path.join(TASK, "claim-denials-snf-v3.dev.jsonl"), "utf-8"));
  assert.equal(jsonl(buildSplit(SEED, "calibration")), fs.readFileSync(path.join(TASK, "claim-denials-snf-v3.calibration.jsonl"), "utf-8"));
});

test("each archetype gets its quota in each split, and every id and claim file is distinct", async () => {
  const { KINDS, QUOTA } = await gen();
  const items = [...dev(), ...calibration()];
  for (const [split, list] of [["dev", dev()], ["calibration", calibration()]] as const) {
    for (const archetype of Object.keys(KINDS)) {
      assert.equal(list.filter((i) => i.tags.includes(archetype)).length, QUOTA[split], `${split} ${archetype}`);
    }
    assert.ok(list.every((i) => i.split === split));
  }
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.equal(new Set(items.map((i) => i.input)).size, items.length);
  const hard = dev().filter((i) => i.metadata.difficulty === "hard").length / dev().length;
  assert.ok(hard > 0.55 && hard < 0.65, `hard share ${hard}`);
});

test("an item depends only on its own coordinates: a bigger quota leaves the existing items as they are", async () => {
  const { buildItem, SEED } = await gen();
  const committed = dev().find((i) => i.id === "cd3-d-qstay-07");
  assert.deepEqual(buildItem(SEED, "dev", "qualifying-stay", 6), committed);
  assert.notDeepEqual(buildItem(SEED, "holdout", "qualifying-stay", 6).input, committed?.input, "another split, another stream");
});

test("noise never hides a fact the key depends on", () => {
  for (const item of [...dev(), ...calibration()]) {
    const { parse, records, facts } = item.expected.steps;
    for (const field of ["statement_from", "statement_through", "received_date", "remittance_date"]) {
      assert.ok(shows(item.input, parse[field] as string), `${item.id}: ${field} ${parse[field]} not in the claim file`);
    }
    const stay = parse.qualifying_stay as { admit_order: string; discharge: string } | null;
    if (stay) assert.ok(shows(item.input, stay.admit_order) && shows(item.input, stay.discharge), `${item.id}: qualifying stay`);
    assert.ok(item.input.includes(`*${parse.group_code}*${parse.carc}*`), `${item.id}: CAS segment`);
    for (const line of records.relevant) assert.match(item.input, recordPattern(line), `${item.id}: record "${line}"`);
    for (const [key, value] of Object.entries(facts)) {
      if (value !== null) assert.ok(item.input.includes(value), `${item.id}: fact ${key} ${value} not in the claim file`);
    }
    const dropped = item.metadata.noise.find((n) => n.startsWith("missing-field:"))?.split(":")[1];
    if (dropped === "mbi" || dropped === "contractor") assert.equal(facts[dropped], null, `${item.id}: dropped ${dropped} still a fact`);
  }
});

test("the noise mix: some items clean, every noise type used, header and records dated differently when dates are reformatted", () => {
  const items = dev();
  assert.ok(items.some((i) => i.tags.includes("clean")));
  for (const type of ["date-formats", "835-one-line", "distractor-records", "missing-field", "ocr"]) {
    assert.ok(items.some((i) => i.tags.includes(`noise:${type}`)), type);
  }
  for (const item of items.filter((i) => i.tags.includes("noise:date-formats"))) {
    const [header, records] = item.metadata.noise.find((n) => n.startsWith("date-formats:"))!.slice("date-formats:".length).split("+");
    assert.notEqual(header, records, item.id);
  }
});

function runCheck(input: string, output: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd3-check-"));
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ input }));
  fs.writeFileSync(path.join(dir, "output.txt"), output);
  const refs = fs.mkdtempSync(path.join(os.tmpdir(), "cd3-refs-"));
  const item = [...dev(), ...calibration()].find((i) => i.id === input)!;
  fs.writeFileSync(path.join(refs, `${input}.txt`), JSON.stringify(item.expected, null, 2));
  const r = spawnSync("node", [CHECK], { cwd: dir, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: refs } });
  return { code: r.status, out: r.stdout };
}

test("the check passes the triage key and fails a wrong deadline", () => {
  const item = dev().find((i) => i.expected.next_action === "appeal")!;
  const { root_cause, correctable, next_action, deadline } = item.expected;
  assert.equal(runCheck(item.id, JSON.stringify({ root_cause, correctable, next_action, deadline })).code, 0);
  assert.equal(runCheck(item.id, JSON.stringify({ root_cause, correctable, next_action, deadline: "2099-01-01" })).code, 1);
});
