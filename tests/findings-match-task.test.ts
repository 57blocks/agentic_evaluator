/**
 * kind: findings-match on a whole task: spec, items.jsonl with defect and
 * clean items, two free reviewer stand-ins. check-task probes it without a
 * model, a run records the matcher's measures, and changing an option
 * regrades reused trials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preflightTask, type PreflightReport } from "../src/core/preflight.js";
import { runSuite } from "../src/core/execute.js";
import type { TrialRow } from "../src/canon/rows.js";

const SPEC = `protocol_version: "0.3"
run_name: review-demo
budget_usd: 1
workflow:
  steps:
    - id: review
      version: "1"
      test_set: { id: prs-v1, items_file: items.jsonl }
      candidate_ids: [sharp, noisy]
      required_checks: [caught]
      success_criteria: { mandatory_checks: all }
      decision: scorecard
      operating_mode: highest-assurance
      maximum_completion_time_seconds: 30
candidates:
  - id: sharp
    adapter: agent-cli
    cli: { argv: [node, agents/reviewer.mjs], reports_usage: true }
  - id: noisy
    adapter: agent-cli
    cli: { argv: [node, agents/reviewer.mjs, noisy], reports_usage: true }
evaluators:
  required_checks:
    caught:
      kind: findings-match
      line_tolerance: 3
  judge: { model: google/gemini-3.1-pro-preview, provider_route: openrouter, rubric_file: rubrics/unused.md, methods: [] }
execution: { trials_per_case: 1, concurrency: 2 }
x-harness: { producer: codegen, default_temperature: 0 }
`;

/** Flags each "suspect file:line" in its input; the noisy one also nits another file, blocking. */
const REVIEWER = `import fs from "node:fs";
const input = fs.readFileSync(".eval-input.txt", "utf8");
const findings = [...input.matchAll(/^suspect (\\S+):(\\d+)$/gm)].map(([, file, line]) => ({ file, start_line: Number(line), message: "this looks wrong", blocking: true }));
if (process.argv[2] === "noisy") findings.push({ file: "src/style.ts", start_line: 1, message: "nit: rename", blocking: true });
fs.writeFileSync("findings.json", JSON.stringify({ findings }));
fs.writeFileSync(".eval-usage.json", JSON.stringify({ cost_usd: 0 }));
`;

const ITEMS = [
  { id: "pr1", input: "pr1\nsuspect src/tax.ts:41\n", tags: ["escaped", "calculation"], expected: { kind: "defect", source: "escaped", defects: [{ file: "src/tax.ts", start_line: 40, end_line: 42, category: "calculation", severity: "high", description: "rate applied twice" }] } },
  // The reviewer points five lines below the defect: a miss at tolerance 3, a catch at 5.
  { id: "pr2", input: "pr2\nsuspect src/pay.ts:15\n", tags: ["seeded", "logic"], expected: { kind: "defect", source: "seeded", defects: [{ file: "src/pay.ts", start_line: 10, category: "logic", description: "off by one" }] } },
  { id: "pr3", input: "pr3\n", tags: ["clean"], expected: { kind: "clean", note: "no later fix" } },
];

async function reviewTask(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "findings-match-"));
  const task = path.join(ws, "tasks", "review-demo");
  await fs.mkdir(path.join(task, "agents"), { recursive: true });
  await fs.mkdir(path.join(task, "rubrics"), { recursive: true });
  await fs.writeFile(path.join(task, "spec.yaml"), SPEC);
  await fs.writeFile(path.join(task, "agents", "reviewer.mjs"), REVIEWER);
  await fs.writeFile(path.join(task, "rubrics", "unused.md"), "unused\n");
  await fs.writeFile(path.join(task, "items.jsonl"), ITEMS.map((i) => JSON.stringify(i)).join("\n") + "\n");
  return path.join(task, "spec.yaml");
}

const finding = (r: PreflightReport, code: string) => r.steps.flatMap((s) => s.findings).find((f) => f.code === code);
const rowsOf = async (dir: string): Promise<TrialRow[]> =>
  (await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l) as TrialRow);
const cell = (rows: readonly TrialRow[], candidate: string, input: string) => rows.find((r) => r.candidate === candidate && r.input === input)!.checks.caught!;

test("check-task: the oracle review passes every item and an empty answer fails, with no model call even when a fallback is declared", async () => {
  const spec = await reviewTask();
  // A fallback that would be called (and fail: no such key) if a probe reached it.
  await fs.writeFile(spec, SPEC.replace("      line_tolerance: 3\n", "      line_tolerance: 3\n      llm_fallback: { model: google/gemini-3.1-pro-preview, api_key_env: NO_SUCH_KEY_FOR_TESTS }\n"));

  const report = await preflightTask(spec);

  assert.equal(finding(report, "check.null")?.severity, "ok");
  assert.equal(finding(report, "check.oracle")?.severity, "ok");
  assert.match(finding(report, "check.oracle")?.message ?? "", /on 3 input\(s\)/);
  assert.match(report.steps.flatMap((s) => s.findings).map((f) => f.message).join("\n"), /caught llm_fallback google\/gemini-3\.1-pro-preview: provider_route openrouter needs NO_SUCH_KEY_FOR_TESTS/);
});

test("a run records the matcher's measures, and a changed option regrades reused trials", async () => {
  const spec = await reviewTask();

  const result = await runSuite(spec, false, { yes: true, onEvent: () => {} });

  assert.ok(result);
  const rows = await rowsOf(result.dir);
  assert.equal(cell(rows, "sharp", "pr1").state, "pass");
  assert.equal(cell(rows, "sharp", "pr2").state, "fail");
  assert.equal(cell(rows, "sharp", "pr3").state, "pass");
  assert.equal(cell(rows, "noisy", "pr3").state, "fail");
  assert.deepEqual(cell(rows, "noisy", "pr1").measures, { findings: 2, invalid_findings: 0, defects: 1, caught: 1, matched_deterministic: 1, matched_llm: 0, unmatched_findings: 1 });
  assert.deepEqual(cell(rows, "noisy", "pr3").measures, { findings: 1, invalid_findings: 0, defect_claims: 1 });
  assert.match(cell(rows, "sharp", "pr1").version, /^findings-match-1\+opts-/);

  // Widen the tolerance: pr2's finding, five lines off, now matches, without running the reviewers again.
  await fs.writeFile(spec, SPEC.replace("line_tolerance: 3", "line_tolerance: 5"));
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    const again = await runSuite(spec, false, { yes: true, onEvent: () => {} });
    const regraded = await rowsOf(again!.dir);
    const pr2 = regraded.find((r) => r.candidate === "sharp" && r.input === "pr2")!;
    assert.ok(pr2.reused_from, "the reviewer was not run again");
    assert.equal(pr2.checks.caught!.state, "pass");
    assert.notEqual(pr2.checks.caught!.version, cell(rows, "sharp", "pr2").version);
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }
});
