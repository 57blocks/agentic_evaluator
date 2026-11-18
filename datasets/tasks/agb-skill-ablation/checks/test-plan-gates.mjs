#!/usr/bin/env node
/**
 * test-design, with or without agb's skills. Passes when .ab/test-plan.json
 * is readable and lists cases. The score is the share of agb's REQUIRED
 * test-plan conditions that hold, as agb-flow-v3 calibrated them on the
 * adopted plans (all clean): no hard ac-coverage finding, and no acceptance
 * criterion left without a covering test. Cases with no `covers` or anchored
 * to a criterion the PRD lacks are counted, never scored.
 */

import { agb, confirmArm, countByGate, ensureGit, finish, finishScored, readJson } from "./lib.mjs";

const UNCOVERED = /acceptance criteria have no AT covering them/;

confirmArm();
const plan = readJson(".ab/test-plan.json");
if (!plan) finish(1, "no readable .ab/test-plan.json was produced", "no test plan");
const tests = Object.values(plan).find(Array.isArray) ?? [];
if (tests.length === 0) finish(1, ".ab/test-plan.json lists no acceptance tests", "empty test plan");

ensureGit();
const { findings, headlines } = agb(["check", "--all", "--gate=ac-coverage", "--stage=test-plan"]);
const hard = findings.filter((f) => f.severity === "hard");
const uncovered = headlines.filter((h) => h.gate === "ac-coverage" && UNCOVERED.test(h.text));
const recorded = Math.max(0, findings.filter((f) => f.severity !== "hard").length - uncovered.length);
finishScored(`${tests.length} acceptance tests; other ac-coverage findings (counted, not scored): ${recorded}`, [
  { name: "no hard ac-coverage finding", clean: hard.length === 0, detail: countByGate(hard) },
  { name: "every AC covered", clean: uncovered.length === 0, detail: uncovered.map((u) => u.text).join("; ").slice(0, 300) },
]);
