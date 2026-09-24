/** Counted nouns in report copy: "1 input", "2 inputs", never "1 inputs". */

import { test } from "node:test";
import assert from "node:assert/strict";
import { plural, stepsHeadline } from "../src/report-format.js";

test("one of a thing is singular", () => {
  assert.equal(plural(1, "input"), "1 input");
});

test("zero and many are plural", () => {
  assert.equal(plural(0, "trial"), "0 trials");
  assert.equal(plural(3, "candidate"), "3 candidates");
});

test("an unknown count keeps the plural noun", () => {
  assert.equal(plural("—", "trial"), "— trials");
});

test("the step headline counts picks and names what needs review", () => {
  const steps = [{ chosen: "sonnet-5" }, { chosen: null }, { chosen: "deepseek-v4-pro" }];
  assert.equal(stepsHeadline(steps), "2 of 3 steps have a recommendation · 1 needs review");
});

test("the step headline says so plainly when every step has a pick", () => {
  assert.equal(stepsHeadline([{ chosen: "a" }, { chosen: "b" }]), "Every step has a recommendation (2 of 2)");
});

test("an unreadable step report is counted, never silently dropped", () => {
  assert.equal(stepsHeadline([{ chosen: "a" }], 1), "1 of 2 steps have a recommendation · 1 report could not be read");
});
