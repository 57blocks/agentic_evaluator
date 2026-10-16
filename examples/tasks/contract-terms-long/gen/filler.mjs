/**
 * Bulk that makes a packet as long as a real one: several SOWs and a security
 * schedule. Sentences are composed from phrase pools, so no two items repeat
 * the same paragraphs. Each SOW states its own term, cap and governing law,
 * none of which overrides the agreement (its precedence clause requires a
 * section number): they are distractors, never answers.
 */

import { pick } from "./structures.mjs";
import { both, longDate, usdBoth, words, addDays } from "./words.mjs";

const SUBJECTS = ["The Vendor", "The project team", "The solution", "Each release", "The service desk", "The migration workstream", "The reporting module", "The integration layer", "The data platform", "The test team"];
const VERBS = ["shall provide", "shall document", "shall configure", "shall validate", "shall maintain", "shall deliver", "shall support", "shall monitor", "shall reconcile", "shall automate"];
const OBJECTS = ["role-based access for all user groups", "nightly extracts of order and inventory data", "a runbook for each production job", "audit logs for administrative actions", "single sign-on through the client's identity provider", "regression test suites for each interface", "dashboards for weekly operational metrics", "data mappings for every legacy field", "rollback procedures for each deployment", "encryption of data at rest and in transit", "a defect triage process with daily review", "capacity reports for peak trading periods", "training materials for site supervisors", "error handling for rejected transactions", "archival of records past their retention date"];
const QUALIFIERS = ["before user acceptance testing begins", "in line with the approved design", "for each of the regional business units", "within the agreed maintenance windows", "without manual intervention", "with evidence retained for audit", "using the client's approved tools", "for both production and staging environments", "as described in the project brief", "subject to the client's change control"];
const ASSUMPTIONS = ["The client will provide access to subject-matter experts for at least {n} hours per week.", "Test data will be supplied by the client in anonymized form.", "Hosting costs are paid directly by the client and are excluded from the fees.", "The client will make decisions on open design questions within {n} Business Days.", "No more than {n} legacy interfaces are in scope.", "Third-party licence fees are excluded unless listed in the pricing table.", "The client's network team will open required firewall routes within {n} Business Days of request.", "Work will be performed remotely except for up to {n} on-site visits.", "The client will nominate a single product owner with authority to accept deliverables.", "Translation of user materials into languages other than English is out of scope."];
const CONTROLS = ["Multi-factor authentication is enforced for all remote access", "Privileged accounts are reviewed every {n} days", "Security patches rated critical are applied within {n} days of release", "Backups are encrypted and tested at least every {n} days", "Production and non-production environments are logically separated", "All laptops use full-disk encryption", "Firewall rules are reviewed every {n} days", "Security awareness training is completed by all Personnel every {n} months", "Penetration tests are performed at least every {n} months", "Logs are retained for at least {n} days", "Access is removed within {n} hours of an employee leaving", "Vendors with access to client data are assessed every {n} months", "Source code is scanned for vulnerabilities before each release", "Incident response procedures are tested every {n} months", "Data centres hold a current SOC 2 Type II report"];
const STATES = ["Delaware", "New York", "California", "Texas", "Illinois", "Colorado", "Washington", "Massachusetts", "Georgia", "Ohio", "Minnesota", "Virginia", "Florida", "Oregon"];

const sentence = (rng) => `${pick(rng, SUBJECTS)} ${pick(rng, VERBS)} ${pick(rng, OBJECTS)} ${pick(rng, QUALIFIERS)}.`;
const withN = (rng, template) => template.replace("{n}", String(pick(rng, [5, 7, 10, 14, 30, 45, 60, 90, 180])));

/** One SOW: scope, deliverables, assumptions, milestones, and its own (non-overriding) term, cap and law. */
export function sowText(rng, c, number, startIso, values) {
  const months = pick(rng, [3, 4, 6, 9, 12]);
  const law = pick(rng, STATES.filter((s) => s !== c.law));
  const capAmount = pick(rng, [100000, 150000, 250000, 400000]);
  const deliverables = Array.from({ length: 24 }, (_, i) => `D${number}.${i + 1} ${sentence(rng)}`);
  const assumptions = Array.from({ length: 10 }, (_, i) => `A${number}.${i + 1} ${withN(rng, pick(rng, ASSUMPTIONS))}`);
  const milestones = Array.from({ length: 6 }, (_, i) => `M${i + 1}  | ${longDate(addDays(startIso, 30 * (i + 1)))} | ${pick(rng, ["Design sign-off", "Build complete", "Integration test exit", "UAT exit", "Go-live", "Hypercare exit", "Data migration rehearsal", "Training complete"])} | ${pick(rng, [10, 15, 20, 25])}% of fixed fee`);
  return [
    `STATEMENT OF WORK NO. ${number}\nUnder the ${c.kind} between ${c.parties[0].name} and ${c.parties[1].name}`,
    `1. SCOPE.\n${Array.from({ length: 6 }, () => sentence(rng)).join(" ")}`,
    `2. DELIVERABLES.\n${deliverables.join("\n")}`,
    `3. ASSUMPTIONS.\n${assumptions.join("\n")}`,
    `4. MILESTONES.\nNo. | Target date | Milestone | Payment\n${milestones.join("\n")}`,
    `5. TERM OF THIS SOW. This SOW starts on ${longDate(startIso)} and continues for ${both(months)} months, unless terminated earlier under the Agreement.`,
    `6. LIABILITY UNDER THIS SOW. ${values.P}'s aggregate liability for this SOW is limited to ${usdBoth(capAmount)}.`,
    `7. GOVERNING LAW FOR THIS SOW. This SOW is governed by the laws of the State of ${law}.`,
    `8. PAYMENT. Each milestone payment is due ${both(values.pay_days)} days after ${values.C} accepts the milestone.`,
  ].join("\n\n");
}

export function securitySchedule(rng, values) {
  const controls = Array.from({ length: 40 }, (_, i) => `E.${i + 1} ${withN(rng, pick(rng, CONTROLS))}. ${values.P} shall provide evidence of this control within ${words(pick(rng, [10, 15, 30]))} days of ${values.C}'s request.`);
  return `SCHEDULE E — INFORMATION SECURITY REQUIREMENTS\n${controls.join("\n")}`;
}
