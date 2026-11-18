#!/usr/bin/env node
/**
 * spec, with or without agb's skills. Passes when the deliverables exist and
 * parse: docs/PRD.md, docs/PRD.source.md and a readable .ab/prd.json. The
 * score is the share of agb's REQUIRED spec gates that are clean, as
 * agb-flow-v3 calibrated them on the adopted PRDs (chessicle, invoice; both
 * clean): no hard finding at the spec stage, prd-id clean (every route has a
 * PAGE-*, every endpoint an API-*), prd-quality clean (buildable). Other
 * partials are counted in the evidence, never scored.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { confirmArm, countByGate, cwd, ensureGit, finish, finishScored, gateDetail, readJson, stageFindings } from "./lib.mjs";

confirmArm();
const prd = readJson(".ab/prd.json");
if (!prd) finish(1, "no readable .ab/prd.json was produced", "no prd.json");
for (const f of ["docs/PRD.md", "docs/PRD.source.md"]) {
  if (!existsSync(path.join(cwd, f))) finish(1, `${f} was not written`, `no ${f}`);
}
ensureGit();
const findings = stageFindings("spec");
const hard = findings.filter((f) => f.severity === "hard");
const STRICT = ["prd-id", "prd-quality"];
const others = findings.filter((f) => f.severity !== "hard" && !STRICT.includes(f.gate));
const pages = Array.isArray(prd.pages) ? prd.pages.length : 0;
finishScored(`${pages} pages in .ab/prd.json; other partials (counted, not scored): ${countByGate(others)}`, [
  { name: "no hard finding", clean: hard.length === 0, detail: countByGate(hard) },
  ...STRICT.map((g) => ({ name: g, clean: gateDetail(findings, g) === null, detail: gateDetail(findings, g) })),
]);
