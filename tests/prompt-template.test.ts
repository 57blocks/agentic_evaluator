/** `{{input}}` is filled with the input verbatim — a `$` in the input is text, not a replacement pattern. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "../src/prompt-template.js";

test("fillTemplate puts the input in verbatim, including replacement-pattern characters", () => {
  assert.equal(fillTemplate("Q: {{input}}\nA:", "price is $'000 and $& or $1"), "Q: price is $'000 and $& or $1\nA:");
  assert.equal(fillTemplate("no placeholder", "x"), "no placeholder");
  assert.equal(fillTemplate("{{input}} and {{input}}", "x"), "x and {{input}}", "only the first placeholder is filled, as before");
});
