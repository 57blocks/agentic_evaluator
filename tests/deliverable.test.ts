import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverableText, parsedUnitsFor, renderArtifacts } from "../src/adapters/deliverable.js";

const FILES = [{ path: "utils.ts", content: "export const a = 1;" }];

test("a CLI agent is judged on the files it left, not on what it said", () => {
  const said = "Created `utils.ts` in the working directory.";
  assert.equal(deliverableText("agent-cli", said, FILES), renderArtifacts(FILES));
  assert.match(deliverableText("agent-cli", said, FILES), /export const a = 1;/);
});

test("a CLI agent that left nothing keeps its printed reply as the record", () => {
  assert.equal(deliverableText("agent-cli", "nothing to do", []), "nothing to do");
});

test("model-api and codegen text is untouched", () => {
  assert.equal(deliverableText("model-api", "prose answer", []), "prose answer");
  assert.equal(deliverableText("codegen", "```file:a.ts\nx\n```", FILES), "```file:a.ts\nx\n```");
});

test("a file-checked agent step counts files, so producing none is not a completion", () => {
  assert.equal(parsedUnitsFor("agent-cli", [], true), 0);
  assert.equal(parsedUnitsFor("agent-cli", FILES, true), 1);
});

test("an agent step with no file check is not judged on file count", () => {
  assert.equal(parsedUnitsFor("agent-cli", [], false), undefined);
});

test("codegen still counts its parsed files regardless of the step's checks", () => {
  assert.equal(parsedUnitsFor("codegen", FILES, false), 1);
  assert.equal(parsedUnitsFor("model-api", FILES, true), undefined);
});
