/** Counted nouns in report copy: "1 input", "2 inputs", never "1 inputs". */

import { test } from "node:test";
import assert from "node:assert/strict";
import { plural } from "../src/report-format.js";

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
