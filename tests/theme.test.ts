/**
 * The dashboard's theme: the OS decides until the reader picks one, and a
 * pick is remembered. Only the pure decision is tested here; the DOM and
 * localStorage wiring around it is a few lines in app/theme.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTheme, parseStoredTheme, resolveTheme } from "../src/demo/client/app/theme.js";

test("with no stored pick the OS decides", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
});

test("a stored pick wins over the OS", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("toggling flips whatever is showing now", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
});

test("anything stored that is not light or dark counts as no pick", () => {
  assert.equal(parseStoredTheme("dark"), "dark");
  assert.equal(parseStoredTheme("light"), "light");
  assert.equal(parseStoredTheme("purple"), null);
  assert.equal(parseStoredTheme(null), null);
});
