/**
 * Syntax colouring for the task page's file viewer.
 *
 * The viewer renders the highlighter's output as HTML, so the one property
 * that must never break is escaping: a task file is untrusted text, and a
 * `<script>` in a rubric has to come out as characters, not as a tag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightFile, languageFor } from "../src/demo/client/lib/highlight.js";

test("the language follows the file extension, and unknown files get none", () => {
  // Act / Assert
  assert.equal(languageFor("spec.yaml"), "yaml");
  assert.equal(languageFor("scaffold/tsconfig.json"), "json");
  assert.equal(languageFor("rubrics/prd.md"), "markdown");
  assert.equal(languageFor("checks/behaviour.mjs"), "javascript");
  assert.equal(languageFor("spec.test.ts"), "typescript");
  assert.equal(languageFor("scripts/run.sh"), "bash");
  assert.equal(languageFor("inputs/todo-app.txt"), null);
});

test("highlighted output marks tokens and escapes markup in the source", () => {
  // Act
  const yaml = highlightFile("spec.yaml", "run_name: demo # note");
  const md = highlightFile("rubrics/x.md", "# Title\n<script>alert(1)</script>");

  // Assert
  assert.ok(yaml?.includes('class="hljs-attr"'), "a YAML key is marked");
  assert.ok(yaml?.includes('class="hljs-comment"'), "a comment is marked");
  assert.ok(md !== null && !md.includes("<script>"), "a tag in the file is not emitted as a tag");
  assert.ok(md?.includes("&lt;script&gt;"), "it is emitted as text");
});

test("a file with no known language is left to be shown as plain text", () => {
  assert.equal(highlightFile("inputs/brief.txt", "anything"), null);
});
