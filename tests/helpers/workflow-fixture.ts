/** One step's worth of workflow input, shared by the workflow and demo suites. */

import type { CostLedger } from "../../src/canon/cost.js";
import type { WorkflowStepInput } from "../../src/canon/workflow.js";

export const WORKFLOW_LEDGER_FIXTURE: CostLedger = {
  generation: 1,
  judging: 2,
  scoring: 0.5,
  checks: 0,
  retries: 0.25,
  total: 3.75,
  source: "provider-reported",
  successes: 1,
  cost_per_success: 3.75,
  cost_per_attempt: 3.75,
};

export function workflowStepFixture(over: Partial<WorkflowStepInput> = {}): WorkflowStepInput {
  return {
    id: "plan",
    dir: "plan",
    operatingMode: "lowest-cost",
    chosen: "cand-a",
    firmness: "directional",
    eligible: ["cand-a"],
    gated: [{ candidate: "cand-b", reason: "reliability 0.5 < 0.8" }],
    trials: 3,
    ledger: WORKFLOW_LEDGER_FIXTURE,
    gaps: "# GAPS\n\n- `ttft_ms`: non-streaming calls.\n- `cache`: not observable.\n",
    ...over,
  };
}
