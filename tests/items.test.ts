/**
 * `test_set.items_file`: a test set as one JSONL file (src/core/items.ts).
 * The file is written out as the inputs/ and references/ files everything
 * already reads, it is hidden with references/ while candidates run, and a
 * generated set moved onto it keeps every byte (and so its paid trials).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ItemsError, materializeItems, parseItemsText, readItems, serializeItemValue } from "../src/core/items.js";
import { hideAnswerKey, restoreAnswerKey } from "../src/core/answer-key.js";
import { loadWorkflow, SpecError } from "../src/spec/load-spec.js";
import { preflightTask, type PreflightReport } from "../src/core/preflight.js";
import { runSuite } from "../src/core/execute.js";

const REPO = path.resolve(import.meta.dirname, "..");
const SAMPLE = path.join(REPO, "examples", "tasks", "custom-check");
const CONTRACTS = path.join(REPO, "datasets", "tasks", "contract-terms-long");

const CHANGELOG = "Write release notes for v2.4.0.\n\n#412 feat: export runs as CSV\n#415 fix: budget guard counted retries twice\n";
const ITEMS = [
  { id: "changelog", input: CHANGELOG, expected: { prs: [412, 415] }, tags: ["ordinary"], split: "dev" },
  { id: "breaking", input: "Write release notes.\n\n#418 feat!: rename budget\n", tags: ["breaking"], split: "holdout" },
];
const jsonl = (rows: readonly unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** The custom-check sample with its test set moved onto items.jsonl. */
async function itemsTask(over: (testSet: Record<string, unknown>) => Record<string, unknown> = (t) => t): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "items-task-"));
  await fs.cp(SAMPLE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) && !src.includes(`${path.sep}inputs`) });
  await fs.writeFile(path.join(dir, "items.jsonl"), jsonl(ITEMS));
  await editSpec(dir, (spec) => {
    const step = spec.workflow.steps[0];
    step.test_set = over({ id: "changelog-v1", items_file: "items.jsonl" });
  });
  return dir;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spec edited as plain YAML data
async function editSpec(dir: string, edit: (spec: any) => void): Promise<void> {
  const file = path.join(dir, "spec.yaml");
  const spec = parseYaml(await fs.readFile(file, "utf-8"));
  edit(spec);
  await fs.writeFile(file, stringifyYaml(spec));
}

const findingOf = (r: PreflightReport, code: string) => r.steps.flatMap((s) => s.findings).find((f) => f.code === code);

test("values are written the way the dataset generators write them", () => {
  assert.equal(serializeItemValue("What was Q3 revenue?"), "What was Q3 revenue?\n");
  assert.equal(serializeItemValue({ usd: 4210000, ok: true }), '{\n  "usd": 4210000,\n  "ok": true\n}\n');
});

test("a bad line is named by file and line number", () => {
  const cases: Array<[string, RegExp]> = [
    ['{"id":"a","input":"x"}\nnot json\n', /items\.jsonl:2: not valid JSON/],
    ['{"id":"a","input":"x"}\n{"id":"a","input":"y"}\n', /items\.jsonl:2: id "a" is already used on line 1/],
    ['{"id":"q-1","input":"x"}\n{"id":"Q-1","input":"y"}\n', /items\.jsonl:2: id "Q-1" is already used on line 1/],
    ['{"id":"a","input":"x","input_file":"a.txt"}\n', /items\.jsonl:1 \(a\): give exactly one of "input" and "input_file"/],
    ['{"id":"a"}\n', /exactly one of "input" and "input_file"/],
    ['{"id":"../a","input":"x"}\n', /items\.jsonl:1: "id" must be a string usable as a file name/],
    ['{"id":"a","input":"x","tags":"hard"}\n', /"tags" must be an array of strings/],
    ['{"id":"a","input":"x","split":1}\n', /"split" must be a string/],
    ["\n\n", /items\.jsonl: no items/],
  ];
  for (const [text, message] of cases) assert.throws(() => parseItemsText(text, "items.jsonl"), message);
});

test("keys the engine does not use, such as provenance, are allowed", () => {
  const [item] = parseItemsText('{"id":"a","input":"x","provenance":{"source":"synthetic"}}\n', "items.jsonl");
  assert.equal(item?.id, "a");
});

test("input_file is read as it stands, and must stay inside the task", async () => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "items-file-"));
  await fs.mkdir(path.join(task, "packets"));
  await fs.writeFile(path.join(task, "packets", "long.txt"), "a long packet, no trailing newline");
  await fs.writeFile(path.join(task, "items.jsonl"), jsonl([{ id: "long", input_file: "packets/long.txt" }]));
  assert.equal(readItems(task, "items.jsonl")[0]?.input, "a long packet, no trailing newline");

  await fs.writeFile(path.join(task, "escape.jsonl"), jsonl([{ id: "x", input_file: "../outside.txt" }]));
  assert.throws(() => readItems(task, "escape.jsonl"), /input_file "\.\.\/outside\.txt" must be a path inside the task/);
});

/** Set a file's mtime relative to now, so "changed before / after the items file" is not left to the clock. */
const ageBy = (file: string, seconds: number): Promise<void> => {
  const t = new Date(Date.now() + seconds * 1000);
  return fs.utimes(file, t, t);
};

test("writing out creates inputs/ and references/, and leaves equal files alone", async () => {
  // Arrange
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "items-out-"));
  await fs.writeFile(path.join(task, "items.jsonl"), jsonl(ITEMS));
  const items = readItems(task, "items.jsonl");

  // Act
  await materializeItems(task, "items.jsonl", items);
  const before = (await fs.stat(path.join(task, "inputs", "changelog.txt"))).mtimeMs;
  await materializeItems(task, "items.jsonl", items);

  // Assert
  assert.equal(await fs.readFile(path.join(task, "inputs", "changelog.txt"), "utf-8"), CHANGELOG + "\n");
  assert.equal(await fs.readFile(path.join(task, "references", "changelog.txt"), "utf-8"), '{\n  "prs": [\n    412,\n    415\n  ]\n}\n');
  await assert.rejects(fs.stat(path.join(task, "references", "breaking.txt")), "no expected, no reference");
  assert.equal((await fs.stat(path.join(task, "inputs", "changelog.txt"))).mtimeMs, before, "an equal file is not rewritten");
});

test("an edit to the items file rewrites the files written from it; an answer it no longer has must be deleted by hand", async () => {
  // Arrange - files written, then the items file edited after them
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "items-edit-"));
  const file = path.join(task, "items.jsonl");
  await fs.writeFile(file, jsonl(ITEMS));
  await materializeItems(task, "items.jsonl", readItems(task, "items.jsonl"));
  await ageBy(path.join(task, "inputs", "changelog.txt"), -60);
  await ageBy(path.join(task, "references", "changelog.txt"), -60);
  await fs.writeFile(file, jsonl([{ id: "changelog", input: "a new question" }, ITEMS[1]]));

  // Act + Assert - the old answer key may be hand-written: refused, not deleted
  await assert.rejects(
    materializeItems(task, "items.jsonl", readItems(task, "items.jsonl")),
    /references\/changelog\.txt is an answer key for a line of items\.jsonl with no "expected": add the answer to the line, or delete the file/,
  );
  assert.match(await fs.readFile(path.join(task, "references", "changelog.txt"), "utf-8"), /"prs"/);
  await fs.rm(path.join(task, "references", "changelog.txt"));
  await materializeItems(task, "items.jsonl", readItems(task, "items.jsonl"));
  assert.equal(await fs.readFile(path.join(task, "inputs", "changelog.txt"), "utf-8"), "a new question\n");
});

test("a file edited by hand after the items file fails the load, named, and is left as it is", async () => {
  // Arrange
  const task = await itemsTask();
  await loadWorkflow(path.join(task, "spec.yaml"));
  const ref = path.join(task, "references", "changelog.txt");
  await fs.writeFile(ref, "edited\n");
  await ageBy(ref, 60);

  // Act + Assert - the same for check-task, a run, and any other load
  await assert.rejects(
    loadWorkflow(path.join(task, "spec.yaml")),
    /references\/changelog\.txt was changed after items\.jsonl and no longer matches it\. items\.jsonl is the source: put the change there, or delete the file/,
  );
  await assert.rejects(runSuite(path.join(task, "spec.yaml"), false, { yes: true }), /references\/changelog\.txt was changed after items\.jsonl/);
  assert.equal(await fs.readFile(ref, "utf-8"), "edited\n");

  // Deleting it has it written again.
  await fs.rm(ref);
  await loadWorkflow(path.join(task, "spec.yaml"));
  assert.match(await fs.readFile(ref, "utf-8"), /"prs"/);
});

test("a references/<id>/ directory beside an expected answer is refused: it would be graded instead", async () => {
  const task = await itemsTask();
  await fs.mkdir(path.join(task, "references", "changelog"), { recursive: true });
  await assert.rejects(loadWorkflow(path.join(task, "spec.yaml")), /references\/changelog\/ would be graded instead of items\.jsonl's expected for changelog/);
});

test("a spec with items_file and no inputs runs every item, with tags and split on the suite", async () => {
  const task = await itemsTask();

  const [suite] = await loadWorkflow(path.join(task, "spec.yaml"));

  assert.deepEqual(suite?.inputs, ["changelog", "breaking"]);
  assert.equal(suite?.itemsFile, "items.jsonl");
  assert.deepEqual(suite?.labels, { changelog: { tags: ["ordinary"], split: "dev" }, breaking: { tags: ["breaking"], split: "holdout" } });
  assert.equal(await fs.readFile(path.join(task, "inputs", "breaking.txt"), "utf-8"), ITEMS[1]!.input + "\n");
});

test("inputs beside items_file picks a subset, and names ids the file does not have", async () => {
  const subset = await itemsTask((t) => ({ ...t, inputs: ["breaking"] }));
  assert.deepEqual((await loadWorkflow(path.join(subset, "spec.yaml")))[0]?.inputs, ["breaking"]);

  const stranger = await itemsTask((t) => ({ ...t, inputs: ["breaking", "nope"] }));
  await assert.rejects(loadWorkflow(path.join(stranger, "spec.yaml")), /inputs nope are not in items\.jsonl/);
});

test("items_file refuses labels_file beside it, a multi-step spec, and a test set with neither inputs nor items", async () => {
  const both = await itemsTask((t) => ({ ...t, labels_file: "checks/manifest.json" }));
  await assert.rejects(loadWorkflow(path.join(both, "spec.yaml")), /both items_file and labels_file/);

  const multi = await itemsTask();
  await editSpec(multi, (spec) => spec.workflow.steps.push({ ...spec.workflow.steps[0], id: "second" }));
  await assert.rejects(loadWorkflow(path.join(multi, "spec.yaml")), /items_file supports single-step tasks for now; this spec has 2 steps/);

  const neither = await itemsTask((t) => ({ id: t.id }));
  await assert.rejects(loadWorkflow(path.join(neither, "spec.yaml")), (err: unknown) => err instanceof SpecError && /test_set needs inputs or items_file/.test(err.message));
});

test("a broken items file fails the load with the line that broke it", async () => {
  const task = await itemsTask();
  await fs.writeFile(path.join(task, "items.jsonl"), '{"id":"a","input":"x"}\n{"id":"a","input":"y"}\n');
  await assert.rejects(loadWorkflow(path.join(task, "spec.yaml")), (err: unknown) => err instanceof SpecError && /items\.jsonl:2: id "a" is already used on line 1/.test(err.message));
});

test("the items file is hidden with references/ during a run, and put back after", async () => {
  const task = await itemsTask();
  await loadWorkflow(path.join(task, "spec.yaml"));
  const items = path.join(task, "items.jsonl");

  const key = await hideAnswerKey(task, ["items.jsonl"]);
  await assert.rejects(fs.readFile(items, "utf-8"), /EACCES/);
  await assert.rejects(fs.readdir(path.join(task, "references")), /EACCES/);
  // The same process can still load the spec meanwhile (the dashboard's catalog), and writes nothing.
  assert.deepEqual((await loadWorkflow(path.join(task, "spec.yaml")))[0]?.inputs, ["changelog", "breaking"]);
  await key.restore();

  assert.match(await fs.readFile(items, "utf-8"), /"id":"changelog"/);
});

test("an items file a killed run left unreadable is put back by check-task, before the spec is read", async () => {
  const task = await itemsTask();
  await fs.chmod(path.join(task, "items.jsonl"), 0);

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(findingOf(report, "references.restored")?.severity, "warning");
  assert.equal(findingOf(report, "items.file")?.severity, "ok");
  assert.match(findingOf(report, "items.file")?.message ?? "", /2 inputs from items\.jsonl/);
});

test("a reader that never loaded the file is told why it cannot, and what to run", async () => {
  const task = await itemsTask();
  await fs.chmod(path.join(task, "items.jsonl"), 0);
  await assert.rejects(loadWorkflow(path.join(task, "spec.yaml")), /a run hides it while candidates work.*agenteval check-task/);
  restoreAnswerKey(task, ["items.jsonl"]);
});

test("a run after a killed run puts the items file back before reading it", async () => {
  const task = await itemsTask();
  await fs.chmod(path.join(task, "items.jsonl"), 0);

  await runSuite(path.join(task, "spec.yaml"), false, { yes: true });

  assert.match(await fs.readFile(path.join(task, "items.jsonl"), "utf-8"), /"id":"changelog"/);
  assert.equal((await fs.readdir(path.join(task, "runs"))).length, 1);
});

test("a run from an items file: candidates cannot read it, and the manifest keeps its tags", async () => {
  // Arrange - a third candidate looks for the items file the way an agent would, from its own script's directory.
  const task = await itemsTask();
  const out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "items-snoop-")), "seen.txt");
  await fs.writeFile(
    path.join(task, "agents", "snoop.mjs"),
    `import fs from "node:fs";\nimport path from "node:path";\nlet seen;\ntry { seen = fs.readFileSync(path.join(import.meta.dirname, "..", "items.jsonl"), "utf-8"); } catch (e) { seen = e.code; }\nfs.appendFileSync(process.argv[2], seen + "\\n");\nfs.writeFileSync("RELEASE_NOTES.md", "# nothing\\n");\nfs.writeFileSync(".eval-usage.json", JSON.stringify({ cost_usd: 0 }));\n`,
  );
  await editSpec(task, (spec) => {
    spec.candidates.push({ id: "snoop", adapter: "agent-cli", cli: { argv: ["node", "agents/snoop.mjs", out], reports_usage: true } });
    spec.workflow.steps[0].candidate_ids.push("snoop");
  });

  // Act
  await runSuite(path.join(task, "spec.yaml"), false, { yes: true });

  // Assert
  assert.deepEqual((await fs.readFile(out, "utf-8")).trim().split("\n"), ["EACCES", "EACCES"]);
  assert.match(await fs.readFile(path.join(task, "items.jsonl"), "utf-8"), /"id":"changelog"/, "readable again after the run");
  const runId = (await fs.readdir(path.join(task, "runs")))[0]!;
  const manifest = JSON.parse(await fs.readFile(path.join(task, "runs", runId, "manifest.json"), "utf-8"));
  assert.deepEqual(manifest.test_set.labels.breaking, { tags: ["breaking"], split: "holdout" });
  assert.deepEqual(Object.keys(manifest.test_set.inputs), ["changelog", "breaking"]);
});

test("contract-terms-long's jsonl writes out byte for byte the files its runs were paid on", () => {
  const items = readItems(CONTRACTS, "contract-terms-long.jsonl");
  return (async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(CONTRACTS, "checks", "manifest.json"), "utf-8"));
    assert.equal(items.length, 100);
    for (const item of items) {
      assert.equal(item.input, await fs.readFile(path.join(CONTRACTS, "inputs", `${item.id}.txt`), "utf-8"), `inputs/${item.id}.txt`);
      assert.equal(item.expected, await fs.readFile(path.join(CONTRACTS, "references", `${item.id}.txt`), "utf-8"), `references/${item.id}.txt`);
      assert.deepEqual(item.tags, manifest[item.id].tags, `${item.id} tags`);
      assert.equal(item.split, manifest[item.id].split, `${item.id} split`);
    }
  })();
});

test("ItemsError is what a bad file throws, for callers that tell it apart", () => {
  assert.throws(() => parseItemsText("[]\n", "x.jsonl"), ItemsError);
});
