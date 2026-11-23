/** tasks/kyc-ubo-v3: a stratified, per-item-seeded, roughened rebuild of kyc-ubo-v2 whose answers still come from v2's solver. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("datasets/tasks/kyc-ubo-v3");
const gen = () => import(pathToFileURL(path.join(TASK, "gen", "generate.mjs")).href);

type Holder = { holder: string; kind: string; nominal_eur: number; voting?: boolean };
type Item = {
  id: string;
  input: string;
  split: string;
  tags: string[];
  expected: {
    beneficial_owners: { name: string }[];
    fictitious_beneficial_owners: string[];
    steps: { ownership: { target: string; entities: Record<string, { capital_eur: number; own_shares_eur?: number; holders: Holder[] }> } };
  };
  metadata: { difficulty: string; noise: string[] };
};

const readJsonl = (file: string): Item[] =>
  fs.readFileSync(path.join(TASK, file), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
const dev = () => readJsonl("kyc-ubo-v3.dev.jsonl");
const calibration = () => readJsonl("kyc-ubo-v3.calibration.jsonl");

/** Every way the roughened extract may write a euro amount. */
function amountSpellings(n: number): string[] {
  const whole = Math.floor(n).toLocaleString("de-DE");
  const cents = String(Math.round((n % 1) * 100)).padStart(2, "0");
  return [`${whole},${cents} EUR`, `EUR ${whole},${cents}`, `${whole},${cents} €`, ...(cents === "00" ? [`${whole},– EUR`] : [])];
}

test("the committed dev and calibration files are what the generator builds, byte for byte", async () => {
  const { buildSplit, SEED } = await gen();
  const jsonl = (items: unknown[]) => items.map((i) => JSON.stringify(i)).join("\n") + "\n";
  assert.equal(jsonl(buildSplit(SEED, "dev")), fs.readFileSync(path.join(TASK, "kyc-ubo-v3.dev.jsonl"), "utf-8"));
  assert.equal(jsonl(buildSplit(SEED, "calibration")), fs.readFileSync(path.join(TASK, "kyc-ubo-v3.calibration.jsonl"), "utf-8"));
});

test("each archetype gets its quota in each split, and every id and extract is distinct", async () => {
  const { KINDS, QUOTA } = await gen();
  for (const [split, list] of [["dev", dev()], ["calibration", calibration()]] as const) {
    for (const archetype of Object.keys(KINDS)) {
      assert.equal(list.filter((i) => i.tags.includes(archetype)).length, QUOTA[split], `${split} ${archetype}`);
    }
  }
  const items = [...dev(), ...calibration()];
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.equal(new Set(items.map((i) => i.input)).size, items.length);
});

test("an item depends only on its own coordinates", async () => {
  const { buildItem, SEED } = await gen();
  assert.deepEqual(buildItem(SEED, "dev", "kg", 4), dev().find((i) => i.id === "ubo3-d-kg-05"));
});

test("noise never hides who holds what: every holder, amount and voting note still reads in the extract", () => {
  for (const item of [...dev(), ...calibration()]) {
    for (const [name, entity] of Object.entries(item.expected.steps.ownership.entities)) {
      assert.ok(item.input.includes(name), `${item.id}: entity ${name}`);
      for (const h of entity.holders) {
        assert.ok(item.input.includes(h.holder), `${item.id}: holder ${h.holder}`);
        assert.ok(amountSpellings(h.nominal_eur).some((s) => item.input.includes(s)), `${item.id}: ${h.holder}'s ${h.nominal_eur} EUR`);
      }
      if (entity.holders.some((h) => h.voting === false)) assert.match(item.input, /kein Stimmrecht/, `${item.id}: non-voting note`);
      if (entity.own_shares_eur) assert.match(item.input, /eigene Geschäftsanteile/, `${item.id}: own shares`);
    }
    for (const name of [...item.expected.beneficial_owners.map((o) => o.name), ...item.expected.fictitious_beneficial_owners]) {
      assert.ok(item.input.includes(name), `${item.id}: owner ${name}`);
    }
  }
});

test("the noise mix: some items clean, every noise type used", () => {
  const items = dev();
  assert.ok(items.some((i) => i.tags.includes("clean")));
  for (const type of ["date-formats", "amount-formats", "table-layout", "distractor-entries", "missing-detail", "ocr"]) {
    assert.ok(items.some((i) => i.tags.includes(`noise:${type}`)), type);
  }
});

test("a register entry added as noise never contradicts the company's legal form", () => {
  for (const item of [...dev(), ...calibration()]) {
    const kg = item.input.split("\n")[1].endsWith("& Co. KG");
    if (kg) assert.doesNotMatch(item.input, /Rechtsform: Gesellschaft mit beschränkter Haftung/, item.id);
    else assert.doesNotMatch(item.input, /Rechtsform: Kommanditgesellschaft/, item.id);
  }
});

test("a KG names its general partner with the seat and HRB number of the partner's own register block", () => {
  const kgs = [...dev(), ...calibration()].filter((i) => i.tags.includes("kg"));
  assert.ok(kgs.length > 0);
  for (const item of kgs) {
    // The number is absent when the noise dropped register numbers.
    const named = item.input.match(/Gesellschafterin: (.+?), Sitz ([^,]+?)(?:, HRB (\d+))?, ohne Kapitalanteil/);
    assert.ok(named, item.id);
    const block = item.input.split("\n\n").find((b) => b.includes(`Firma: ${named[1]}`));
    if (named[3]) assert.ok(block?.split("\n")[0].includes(`, HRB ${named[3]}`), `${item.id}: HRB ${named[3]} not on the partner's own block`);
    assert.ok(block?.split("\n")[0].includes(named[2]), `${item.id}: seat ${named[2]} not the partner's court`);
  }
});
