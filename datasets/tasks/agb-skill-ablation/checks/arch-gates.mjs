#!/usr/bin/env node
/**
 * architecture, with or without agb's skills. Passes when the deliverables
 * exist and parse: _contracts/api-routes.json with endpoints and
 * docs/DESIGN.md. The score is the share of agb's REQUIRED arch gates that
 * are clean, as agb-flow-v3 calibrated them on the adopted designs
 * (demo-todo, chessicle, invoice; all clean): no hard finding at the arch
 * stage, design-closure clean (every DEC-* referenced is defined). Other
 * partials (arch-closure among them) are counted, never scored.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { confirmArm, countByGate, cwd, ensureGit, finish, finishScored, gateDetail, readJson, stageFindings } from "./lib.mjs";

confirmArm();
const routes = readJson("_contracts/api-routes.json");
const endpoints = Array.isArray(routes?.endpoints) ? routes.endpoints.length : 0;
if (endpoints === 0) finish(1, "_contracts/api-routes.json is missing or lists no endpoints", "no API contract");
if (!existsSync(path.join(cwd, "docs", "DESIGN.md"))) finish(1, "docs/DESIGN.md was not written", "no DESIGN.md");
const arch = readJson(".ab/arch.json");
const components = Array.isArray(arch?.components) ? `${arch.components.length} components` : "no .ab/arch.json";
ensureGit();
const findings = stageFindings("arch");
const hard = findings.filter((f) => f.severity === "hard");
const others = findings.filter((f) => f.severity !== "hard" && f.gate !== "design-closure");
finishScored(`${endpoints} endpoints, ${components}; other partials (counted, not scored): ${countByGate(others)}`, [
  { name: "no hard finding", clean: hard.length === 0, detail: countByGate(hard) },
  { name: "design-closure", clean: gateDetail(findings, "design-closure") === null, detail: gateDetail(findings, "design-closure") },
]);
