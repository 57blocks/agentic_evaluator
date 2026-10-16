/** The judge on a workflow's end product (docs/design/agb-flow-gaps.md C1). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { caseKey, judgeDeliveries } from "../src/core/e2e-judge.js";
import type { judgePair } from "../src/judge.js";
import type { Suite } from "../src/types.js";

test("each case both arms delivered is judged on the files shown; the rest are left out", async () => {
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-judge-"));
  await fs.mkdir(path.join(taskRoot, "rubrics"));
  await fs.writeFile(path.join(taskRoot, "rubrics", "delivery.md"), "1. **code**: clear.\n");
  const seen: { a: string; b: string }[] = [];
  const fake = (async (p: Parameters<typeof judgePair>[0]) => {
    seen.push({ a: p.aText, b: p.bText });
    return {
      inputSlug: p.inputSlug, a: p.a, b: p.b,
      overall: { forward: "b", reverse: "b", resolved: "b", reason: "cleaner" },
      dimensions: { code: { forward: "b", reverse: "b", resolved: "b" } },
      usage: { calls: 2, costUsd: 0.01, retryCostUsd: 0, costSource: "reported", ms: 5 },
    };
  }) as unknown as typeof judgePair;

  const result = await judgeDeliveries({
    root: { taskRoot, judge: "google/gemini-3.1-pro-preview" } as Suite,
    config: { rubricFile: "rubrics/delivery.md", show: ["src/**"], dimensions: ["code"] },
    control: new Map([
      [caseKey("demo", 0), [{ path: "src/a.ts", content: "control" }, { path: "package-lock.json", content: "lock" }]],
      [caseKey("other", 0), [{ path: "src/a.ts", content: "only control delivered" }]],
    ]),
    proposed: new Map([[caseKey("demo", 0), [{ path: "src/a.ts", content: "proposed" }]]]),
    judge: fake,
  });

  assert.equal(seen.length, 1, "only the case both arms delivered");
  assert.equal(seen[0]!.a, "```file:src/a.ts\ncontrol\n```", "judge.show keeps the lockfile out");
  assert.deepEqual(result.wins, { control: 0, proposed: 1, tie: 0 });
  assert.deepEqual(result.cases, [{ input: "demo", trial: 0, winner: "proposed", reason: "cleaner", dimensions: { code: "proposed" } }]);
  assert.equal(result.role, "informs");
  assert.equal(result.cost_usd, 0.01);
});
