#!/usr/bin/env node
/**
 * The deadline step without a model: the case's next_action and dates, put
 * through RULES.md as plain date arithmetic. It answers the question "once
 * the decision is made, does this step need an LLM at all?"
 *
 * Written from RULES.md, not from gen/rules.mjs, so it is not the answer key
 * grading itself:
 *   corrected_claim   R1/R3: one calendar year after the Through date, then R7
 *   reopening         R1: one calendar year after the remittance (R7 does not
 *                     settle it; the key accepts the anniversary itself)
 *   appeal            R2: 120 days from receipt, presumed 5 days after the
 *                     remittance, then R7
 *   write_off, bill_patient, anything else: null
 * R7: a Saturday, Sunday or federal holiday (5 U.S.C. 6103(a), observed the
 * Friday before / Monday after) moves the deadline to the next workday.
 *
 * Reads the case from .eval-input.txt in its work dir, writes {"deadline": …}
 * to deadline.json (a command candidate's deliverable is the files it leaves;
 * with none, agenteval records the trial as not completed), prints the same,
 * and reports a cost of $0 in .eval-usage.json.
 */

import fs from "node:fs";

const DAY_MS = 86_400_000;
const PRESUMED_RECEIPT_DAYS = 5;
const REDETERMINATION_DAYS = 120;

const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;

const sameDayNextYear = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
const asDate = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const plusDays = (day, days) => iso(new Date(asDate(day).getTime() + days * DAY_MS));

/** The n-th given weekday of a month (n = -1: the last). */
function nth(year, month, weekday, n) {
  const days = Array.from({ length: 31 }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1)))
    .filter((d) => d.getUTCMonth() === month - 1 && d.getUTCDay() === weekday);
  return iso(n === -1 ? days.at(-1) : days[n - 1]);
}

/** A fixed-date holiday as observed: Saturday → the Friday before, Sunday → the Monday after. */
function observedOn(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const shift = date.getUTCDay() === SATURDAY ? -1 : date.getUTCDay() === SUNDAY ? 1 : 0;
  return plusDays(iso(date), shift);
}

function holidays(year) {
  return new Set([
    observedOn(year, 1, 1), nth(year, 1, MONDAY, 3), nth(year, 2, MONDAY, 3), nth(year, 5, MONDAY, -1),
    observedOn(year, 6, 19), observedOn(year, 7, 4), nth(year, 9, MONDAY, 1), nth(year, 10, MONDAY, 2),
    observedOn(year, 11, 11), nth(year, 11, THURSDAY, 4), observedOn(year, 12, 25),
  ]);
}

function nextWorkday(day) {
  let d = day;
  while ([SATURDAY, SUNDAY].includes(asDate(d).getUTCDay()) || holidays(Number(d.slice(0, 4))).has(d)) d = plusDays(d, 1);
  return d;
}

const DEADLINE = {
  corrected_claim: (c) => nextWorkday(sameDayNextYear(c.statement_through)),
  reopening: (c) => sameDayNextYear(c.remittance_date),
  appeal: (c) => nextWorkday(plusDays(c.remittance_date, PRESUMED_RECEIPT_DAYS + REDETERMINATION_DAYS)),
};

fs.writeFileSync(".eval-usage.json", JSON.stringify({ cost_usd: 0 }));
const text = fs.readFileSync(".eval-input.txt", "utf-8");
const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
let input;
try {
  input = JSON.parse(json);
} catch {
  process.stderr.write("input is not a JSON case\n");
  process.exit(1);
}
const rule = DEADLINE[input.next_action];
const answer = `${JSON.stringify({ deadline: rule ? rule(input) : null })}\n`;
fs.writeFileSync("deadline.json", answer);
process.stdout.write(answer);
