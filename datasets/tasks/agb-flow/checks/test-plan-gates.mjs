#!/usr/bin/env node
/**
 * qa: a test plan was written, and every acceptance criterion in the PRD has
 * at least one acceptance test covering it (agb's ac-coverage gate).
 *
 * Calibrated on the plans demo-todo, chessicle and invoice adopted: none
 * leaves a criterion uncovered. What is recorded, not gated:
 *   - tests with no `covers` (all three adopted plans have some: 1, 4, 9);
 *   - tests anchored to a criterion the PRD does not have (chessicle's
 *     adopted plan has 32, numbered differently from its PRD).
 */

import { agb, countByGate, ensureGit, finish, readJson } from "./lib.mjs";

const UNCOVERED = /acceptance criteria have no AT covering them/;

const plan = readJson(".ab/test-plan.json");
if (!plan) finish(1, "no readable .ab/test-plan.json was produced", "no test plan");
const tests = Object.values(plan).find(Array.isArray) ?? [];
if (tests.length === 0) finish(1, ".ab/test-plan.json lists no acceptance tests", "empty test plan");

ensureGit();
const { findings, headlines } = agb(["check", "--all", "--gate=ac-coverage", "--stage=qa"]);
const texts = headlines.filter((h) => h.gate === "ac-coverage").map((h) => ({ ...h }));
const hard = findings.filter((f) => f.severity === "hard");
const uncovered = texts.filter((h) => UNCOVERED.test(h.text));
const recorded = findings.filter((f) => f.severity !== "hard").length - uncovered.length;
const summary = `${tests.length} acceptance tests. Other ac-coverage findings (recorded, not gated): ${Math.max(0, recorded)}`;
if (hard.length > 0) finish(1, `${summary}. Hard: ${countByGate(hard)}`, "hard ac-coverage finding");
if (uncovered.length > 0) finish(1, `${summary}. ${uncovered.map((u) => u.text).join("; ")}`, uncovered[0].text);
finish(0, summary);
