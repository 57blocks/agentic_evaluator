#!/usr/bin/env node
/**
 * spec: the external document was normalized into docs/PRD.md and
 * .ab/prd.json, and agb finds nothing hard wrong at the spec stage.
 *
 * Calibrated on the PRDs chessicle and invoice adopted (references/spec/):
 *   REQUIRED  both artifacts, the source snapshot (docs/PRD.source.md), no
 *             hard finding from any gate, and none at all from prd-id (every
 *             route has a PAGE-*, every endpoint an API-*) or prd-quality
 *             (buildable). Both adopted PRDs are clean on these.
 *   RECORDED  every other partial. prd-content-preserved among them: invoice's
 *             adopted PRD drops 158 source lines (its adjudication overrides),
 *             so "the original was rewritten" is counted, not gated on.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { cwd, finish, gradeStage, readJson } from "./lib.mjs";

const prd = readJson(".ab/prd.json");
if (!prd) finish(1, "no readable .ab/prd.json was produced", "no prd.json");
for (const f of ["docs/PRD.md", "docs/PRD.source.md"]) {
  if (!existsSync(path.join(cwd, f))) finish(1, `${f} was not written`, `no ${f}`);
}
const pages = Array.isArray(prd.pages) ? prd.pages.length : 0;
gradeStage("spec", { strict: ["prd-id", "prd-quality"], summary: `${pages} pages in .ab/prd.json` });
