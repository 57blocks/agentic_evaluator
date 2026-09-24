/**
 * Workflow layer: the record above the steps, its gaps file, and the page.
 *
 * The record is the only place total system cost exists, so the arithmetic is
 * pinned here; the page is checked for the three things it alone shows — the
 * §8 verdict, the two arms, and what was not compared.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { E2eValidation } from "../src/canon/e2e.js";
import { buildWorkflowRecord, workflowGaps, workflowLedger } from "../src/canon/workflow.js";
import { WORKFLOW_LEDGER_FIXTURE as LEDGER, workflowStepFixture as step } from "./helpers/workflow-fixture.js";
import { renderWorkflowReport } from "../src/report-workflow.js";

const VALIDATION: E2eValidation = {
  rule_version: "e2e-validate-v1",
  verdict: "keep-control",
  firmness: "directional",
  operating_mode: "lowest-cost",
  thresholds: { minimum_reliability: 0.8, minimum_required_check_pass_rate: 1 },
  assignment: { plan: "cand-a", code: "cand-b" },
  control_assignment: { plan: "cand-a", code: "cand-a" },
  deltas: {
    metric: "cost_per_success",
    proposed: 0.2,
    control: 0.18,
    improvement: -0.02,
    mmd: 0.05,
    paired: { compared: 3, both_success: 2, proposed_only: 0, control_only: 1, neither: 0 },
  },
  not_compared: ["every single-configuration workflow", "the current production workflow"],
  reasons: ["improvement -0.02 does not clear the declared minimum meaningful difference 0.05"],
};

const ARM = {
  kind: "control" as const,
  candidate: "cand-a",
  assignment: { plan: "cand-a", code: "cand-a" },
  chain: ["plan", "code"],
  cases: 3,
  success: 2,
  failure: 1,
  undetermined: 0,
  cost_usd: 0.6,
};

test("workflow ledger sums every step component and keeps the arms separate", () => {
  // Arrange
  const steps = [step(), step({ id: "code", dir: "code", ledger: { ...LEDGER, generation: 3, total: 5.75 } })];

  // Act
  const l = workflowLedger(steps, [ARM, { ...ARM, kind: "proposed", cost_usd: 0.4 }]);

  // Assert
  assert.equal(l.generation, 4);
  assert.equal(l.judging, 4);
  assert.equal(l.steps_total, 9.5);
  assert.equal(l.e2e_total, 1);
  assert.equal(l.total, 10.5);
});

test("estimated cost anywhere in the chain labels the whole workflow estimated", () => {
  const steps = [step(), step({ id: "code", dir: "code", ledger: { ...LEDGER, source: "estimated" } })];
  assert.equal(workflowLedger(steps, []).source, "estimated");
});

test("record keeps the fields the demo catalog reads", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.3",
    runId: "r-1",
    runName: "r",
    steps: [step()],
    control: ARM,
    proposed: null,
    validation: VALIDATION,
  });

  assert.equal(record.run_name, "r");
  assert.equal(record.handoff, true);
  assert.equal(record.steps[0].dir, "plan");
  assert.equal(record.steps[0].chosen, "cand-a");
  assert.equal(record.steps[0].ledger_total, 3.75);
  assert.equal(record.e2e_control?.candidate, "cand-a");
});

test("independent steps record no handoff and no validation", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.3",
    runId: "r-1",
    runName: "r",
    steps: [step(), step({ id: "code", dir: "code" })],
    control: null,
    proposed: null,
    validation: null,
  });

  assert.equal(record.handoff, false);
  assert.equal(record.e2e_validation, null);
  assert.equal(record.ledger.e2e_total, 0);
});

test("workflow gaps state a shared gap once and attribute the rest", () => {
  const steps = [
    { id: "plan", gaps: "- `ttft_ms`: none.\n- `cache`: not observable.\n" },
    { id: "code", gaps: "- `ttft_ms`: none.\n- evaluator errors: 2 rows.\n" },
  ];

  const md = workflowGaps(steps, VALIDATION);

  assert.equal(md.match(/`ttft_ms`/g)?.length, 1, "a gap every step shares is stated once");
  assert.match(md, /`plan`: `cache`: not observable\./);
  assert.match(md, /`code`: evaluator errors: 2 rows\./);
  assert.match(md, /not compared: every single-configuration workflow/);
});

test("workflow gaps say plainly that independent steps were never compared", () => {
  const md = workflowGaps([{ id: "plan", gaps: "- `cache`: not observable.\n" }], null);
  assert.match(md, /no end-to-end validation/);
});

test("page shows the verdict, both arms, the deciding metric and what was not compared", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.3",
    runId: "r-1",
    runName: "chain",
    steps: [step(), step({ id: "code", dir: "code", chosen: "cand-b" })],
    control: ARM,
    proposed: { ...ARM, kind: "proposed", assignment: { plan: "cand-a", code: "cand-b" }, cost_usd: 0.4 },
    validation: VALIDATION,
  });

  const html = renderWorkflowReport(record, workflowGaps([{ id: "plan", gaps: step().gaps }], VALIDATION));

  assert.match(html, /keep-control/);
  assert.match(html, /cost_per_success/);
  assert.match(html, /the current production workflow/);
  assert.match(html, /plan\/report\.html/, "each step links to its own report");
  assert.match(html, /\$8\.5000/, "total system cost = two steps at 3.75 plus 1.00 of arms");
});

test("page renders independent steps without claiming a workflow was validated", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.3",
    runId: "r-1",
    runName: "independent",
    steps: [step()],
    control: null,
    proposed: null,
    validation: null,
  });

  const html = renderWorkflowReport(record, workflowGaps([{ id: "plan", gaps: step().gaps }], null));

  assert.match(html, /no-validation/);
  assert.doesNotMatch(html, /adopt-combination/);
  assert.doesNotMatch(html, /<th class="num">Workflows<\/th>/, "no arm table when no arm ran");
});

test("a step with no eligible candidate is marked, not blank", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.3",
    runId: "r-1",
    runName: "r",
    steps: [step({ chosen: null, firmness: "needs-review", eligible: [] })],
    control: null,
    proposed: null,
    validation: null,
  });

  assert.match(renderWorkflowReport(record, ""), /no recommendation/);
});
