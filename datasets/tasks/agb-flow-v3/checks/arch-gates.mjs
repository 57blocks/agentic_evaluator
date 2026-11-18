#!/usr/bin/env node
/**
 * architecture: the API contract and the design were written, and agb finds
 * nothing hard wrong at the arch stage.
 *
 * Calibrated on the designs demo-todo, chessicle and invoice adopted
 * (references/architecture/):
 *   REQUIRED  _contracts/api-routes.json with endpoints, docs/DESIGN.md, no
 *             hard finding from any gate, and none at all from design-closure
 *             (every DEC-* referenced is defined). All three are clean on these.
 *   RECORDED  every other partial. arch-closure among them: demo-todo's
 *             adopted design predates .ab/arch.json and invoice's has a
 *             component cycle, so it is counted, not gated on; whether
 *             .ab/arch.json was written is said in the evidence.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { cwd, finish, gradeStage, readJson } from "./lib.mjs";

const routes = readJson("_contracts/api-routes.json");
const endpoints = Array.isArray(routes?.endpoints) ? routes.endpoints.length : 0;
if (endpoints === 0) finish(1, "_contracts/api-routes.json is missing or lists no endpoints", "no API contract");
if (!existsSync(path.join(cwd, "docs", "DESIGN.md"))) finish(1, "docs/DESIGN.md was not written", "no DESIGN.md");
const arch = readJson(".ab/arch.json");
const components = Array.isArray(arch?.components) ? `${arch.components.length} components` : "no .ab/arch.json";
gradeStage("arch", { strict: ["design-closure"], summary: `${endpoints} endpoints, ${components}` });
