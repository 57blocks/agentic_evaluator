/**
 * Writes an agreement (structures.mjs) out as a document packet: the
 * agreement with its boilerplate, schedules, its SOWs, and any amendments or
 * restatement, in the order filed. Returns the text and `protected`: every
 * string that carries a graded value, which noise.mjs must leave readable and
 * generate.mjs asserts survives.
 */

import { SECTIONS } from "./library.mjs";
import { pick, shuffled } from "./structures.mjs";
import { addDays, both, longDate, termEnd, usd, usdBoth, words } from "./words.mjs";
import { securitySchedule, sowText } from "./filler.mjs";

const DAY_POOL = [30, 45, 60, 90, 120, 180, 10, 15, 20];
const CITIES = ["New York", "Chicago", "Boston", "Denver", "Seattle", "Atlanta", "Dallas", "Minneapolis"];
const COUNTIES = { "New York": "New York County", California: "San Francisco County", Texas: "Dallas County", Illinois: "Cook County", Delaware: "New Castle County", Colorado: "Denver County", Washington: "King County", Massachusetts: "Suffolk County", Georgia: "Fulton County", Ohio: "Franklin County", Minnesota: "Hennepin County", Virginia: "Fairfax County", Florida: "Miami-Dade County", Oregon: "Multnomah County" };

/** Values for the boilerplate's placeholders: the same kinds of number as the graded ones. */
function distractors(rng, c) {
  const d = () => pick(rng, DAY_POOL);
  const money = () => pick(rng, [1000000, 2000000, 3000000, 5000000]);
  const [gl, pl] = [money(), money()];
  const [conf, records, nonsolicit] = [pick(rng, [2, 3, 5]), pick(rng, [3, 5, 7]), pick(rng, [6, 12, 18, 24])];
  return {
    P: c.parties[0].short, C: c.parties[1].short,
    bank_city: pick(rng, CITIES), pm_days: pick(rng, [7, 14, 30]), change_days: pick(rng, [5, 10]),
    pay_days: d(), dispute_days: d(), expense_days: d(), tax_days: d(), accept_days: pick(rng, [10, 15, 20]), redeliver_days: d(),
    conf_years: conf, conf_years_word: words(conf), return_days: d(), breach_hours: pick(rng, [24, 48, 72]), retention_days: d(),
    scan_days: d(), remediate_days: d(), warranty_days: d(),
    ins_gl: usd(gl), ins_gl_words: words(gl), ins_pl: usd(pl), ins_pl_words: words(pl), ins_notice_days: d(),
    audit_notice_days: d(), records_years: records, records_years_word: words(records),
    nonsolicit_months: nonsolicit, nonsolicit_months_word: words(nonsolicit),
    fm_days: d(), cure_days: d(), convenience_days: d(), transition_days: d(), escalate_days: d(), exec_days: d(),
    venue_state: c.venue, venue_county: COUNTIES[c.venue], courier_days: pick(rng, [1, 2]),
  };
}

const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? `{{${k}}}`));

const NO_TERM = "This Agreement begins on the Effective Date and continues until terminated by either party in accordance with this Agreement.";

/** The renewal sentence for `r`, under an agreement whose definitions may define the renewal terms. */
function renewalSentence(r, key) {
  if (r.kind === "auto") {
    return r.defined
      ? "After the Initial Term, this Agreement renews automatically for successive Renewal Terms unless either party gives written notice of non-renewal no later than the Non-Renewal Notice Period before the end of the then-current term."
      : `After the Initial Term, this Agreement renews automatically for successive periods of ${key(both(r.months))} months each unless either party gives written notice of non-renewal at least ${key(both(r.noticeDays))} days before the end of the then-current term.`;
  }
  if (r.kind === "mutual") return `The parties may renew this Agreement for additional periods of ${both(r.months ?? 12)} months each by mutual written agreement signed at least ${both(r.daysBefore ?? 60)} days before the end of the then-current term. Absent such agreement, this Agreement expires at the end of the then-current term.`;
  return "This Agreement does not renew automatically. It expires at the end of the Initial Term unless the parties extend it by a written amendment signed by both of them.";
}

/** The initial-term sentence: a number of months, or an end date the reader converts to months. */
function termSentence(effectiveDate, months, style, key) {
  return style === "end_date"
    ? `The initial term of this Agreement begins on the Effective Date and ends on ${key(longDate(termEnd(effectiveDate, months)))} (the "Initial Term").`
    : `The initial term of this Agreement is ${key(both(months))} months from the Effective Date (the "Initial Term").`;
}

/** The graded sentences. `key` records each graded surface form. */
function termSentences(c, key) {
  if (c.term === null) return [NO_TERM];
  return [termSentence(c.effective.date, c.term.months, c.term.style, key), renewalSentence(c.renewal, key)];
}

export function capSentence(cap, customer, key) {
  const fees = (m) => `the fees paid or payable by ${customer} under this Agreement in the ${key(both(m))} months preceding the event giving rise to the claim`;
  const head = "Except for the excluded claims below, each party's aggregate liability arising out of or relating to this Agreement shall not exceed";
  if (cap.type === "fixed") return `${head} ${key(usdBoth(cap.amount))}.`;
  if (cap.type === "fees_paid") return `${head} ${fees(cap.months)}.`;
  if (cap.type === "greater_of") return `${head} the greater of (a) ${key(usdBoth(cap.amount))} and (b) ${fees(cap.months)}.`;
  return `${head} ${fees(cap.months)}; provided, however, that in no event shall such aggregate liability exceed ${key(usdBoth(cap.amount))}.`;
}

const lawSentence = (law, key) => `This Agreement and any dispute arising out of it are governed by the laws of the ${key(`State of ${law}`)}, without regard to its conflict-of-laws rules.`;

const EXCLUSION = "Neither party is liable for any indirect, incidental, special or consequential damages, or for lost profits, even if advised of their possibility.";

function liabilityParas(c, values, key) {
  // Without a general cap there is no carve-out either: a cap stated only for one kind of claim would be a different term.
  if (c.cap === null) return [EXCLUSION, "Each party's liability for direct damages is otherwise as provided by applicable law."];
  return [EXCLUSION, capSentence(c.cap, values.C, key), `The limitation above does not apply to a party's indemnification obligations or to its breach of the confidentiality obligations in this Agreement, for which that party's aggregate liability shall not exceed ${usdBoth(c.carveCap)}.`];
}

function preamble(c, key) {
  const [p, q] = c.parties.map((x) => `${key(x.name)}, ${x.entity} ("${x.short}")`);
  const when = {
    as_of: `is entered into as of ${key(longDate(c.effective.date))} (the "Effective Date")`,
    defined: "is entered into as of the Effective Date",
    last_signature: `takes effect on the date on which it has been signed by both parties (the "Effective Date")`,
  }[c.effective.style];
  return `This ${c.kind} (this "Agreement") ${when} by and between ${p}, and ${q}.`;
}

function definitions(c, key) {
  const items = [];
  if (c.effective.style === "defined") items.push(`"Effective Date" means ${key(longDate(c.effective.date))}.`);
  if (c.renewal.kind === "auto" && c.renewal.defined) {
    items.push(`"Non-Renewal Notice Period" means ${key(both(c.renewal.noticeDays))} days.`);
    items.push(`"Renewal Term" means a period of ${key(both(c.renewal.months))} months.`);
  }
  return items;
}

/** Numbered sections; the graded articles sit in the back half, behind most of the boilerplate. A missing clause is simply not there. */
function body(rng, c, values, key) {
  const boiler = shuffled(rng, SECTIONS.slice(1)).map(([title, paras]) => ({ title, paras: paras.map((p) => fill(p, values)) }));
  boiler.find((s) => s.title === "Statements of Work")?.paras.push("If an SOW conflicts with this Agreement, this Agreement controls, unless the SOW expressly identifies by section number the provision of this Agreement that it overrides.");
  const term = { title: "Term and Renewal", paras: termSentences(c, key), id: "term" };
  const cap = { title: "Limitation of Liability", paras: liabilityParas(c, values, key), id: "cap" };
  const law = c.law === null ? [] : [{ title: "Governing Law", paras: [lawSentence(c.law, key)], id: "law" }];
  const cut = Math.floor(boiler.length * 0.6);
  const ordered = [...boiler.slice(0, cut), term, ...boiler.slice(cut, cut + 3), cap, ...boiler.slice(cut + 3, cut + 5), ...law, ...boiler.slice(cut + 5)];
  const defs = [...SECTIONS[0][1].map((p) => fill(p, values)), ...definitions(c, key)];
  const all = [{ title: "Definitions", paras: shuffled(rng, defs), id: "defs" }, ...ordered];
  return all.map((s, i) => ({ ...s, number: i + 1 }));
}

function sectionText(s) {
  return [`SECTION ${s.number}. ${s.title.toUpperCase()}`, ...s.paras.map((p, j) => `${s.number}.${j + 1} ${p}`)].join("\n");
}

function signatureBlock(c, key) {
  // With an effective date set by the later signature, the signature dates are the graded value.
  const date = (iso) => (c.effective.style === "last_signature" ? key(longDate(iso)) : longDate(iso));
  return c.parties.map((p, i) => `${p.name.toUpperCase()}\nBy: /s/ Authorized Signatory\nDate: ${date(c.signatures[i])}`).join("\n\n");
}

function schedules(rng, c, values) {
  const roles = ["Engagement Director", "Program Manager", "Solution Architect", "Senior Engineer", "Engineer", "Data Analyst", "QA Analyst", "Security Specialist", "Technical Writer", "Support Analyst", "Trainer", "Business Analyst"];
  const pricing = roles.flatMap((r) => ["Onshore", "Nearshore", "Offshore"].map((loc) => `${r.padEnd(22)} | ${loc.padEnd(10)} | ${usd(pick(rng, [85, 95, 110, 125, 140, 165, 190, 220, 260]))} per hour`));
  const slas = ["Severity 1 response", "Severity 2 response", "Severity 3 response", "Severity 1 restoration", "Severity 2 restoration", "Monthly availability", "Change request estimate", "Root-cause report", "Backup restore test", "Access revocation"].map((m) => `${m.padEnd(26)} | ${pick(rng, ["15 minutes", "1 hour", "4 hours", "8 hours", "2 Business Days", "5 Business Days", "99.9%", "30 days", "10 days"])} | credit ${pick(rng, [2, 5, 10])}% of monthly fee`);
  return [
    "SCHEDULE A — RATES\nRole                   | Location   | Rate\n" + pricing.join("\n") + `\nRates are fixed for the first ${both(12)} months of each SOW and may then increase by no more than ${pick(rng, [3, 4, 5])}% per year on ${both(values.pay_days)} days' notice.`,
    "SCHEDULE B — SERVICE LEVELS\nMetric                     | Target | Service credit\n" + slas.join("\n") + `\nService credits are capped at ${both(15)} percent of the monthly fee and are ${values.C}'s sole remedy for missed service levels.`,
    `SCHEDULE C — CONTACTS FOR NOTICES\n${values.P}: Legal Department, ${pick(rng, ["1200", "450", "88", "2100"])} ${pick(rng, ["Market Street", "Commerce Drive", "Harbor Way", "Main Street"])}, ${pick(rng, CITIES)}\n${values.C}: General Counsel, ${pick(rng, ["300", "17", "640", "905"])} ${pick(rng, ["Park Avenue", "Lake Street", "Elm Road", "River Plaza"])}, ${pick(rng, CITIES)}`,
    `SCHEDULE D — DATA PROCESSING TERMS\nD.1 ${values.P} shall process personal data only for the purpose of performing the Services and for no longer than ${both(values.retention_days)} days after the end of the applicable SOW.\nD.2 ${values.P} shall ensure that persons authorized to process personal data are bound by confidentiality.\nD.3 ${values.P} shall assist ${values.C} in responding to data subject requests within ${both(values.dispute_days)} days.\nD.4 ${values.P} shall make available the information needed to demonstrate compliance and allow audits on ${both(values.audit_notice_days)} days' notice.\nD.5 Sub-processors may be engaged only on ${both(values.ins_notice_days)} days' prior notice, during which ${values.C} may object.`,
  ];
}

/** The operative lines of an amendment, against the section numbers of the agreement it amends. */
function amendmentLines(a, c, sections, values, key) {
  const sec = (id) => sections.find((s) => s.id === id).number;
  const lines = [];
  const ch = a.changes;
  if (ch.termMonths !== undefined) {
    lines.push(ch.termStyle === "end_date"
      ? `Section ${sec("term")}.1 is amended so that the Initial Term ends on ${key(longDate(termEnd(c.effective.date, ch.termMonths)))}.`
      : `Section ${sec("term")}.1 is deleted and replaced with: "${sec("term")}.1 ${termSentence(c.effective.date, ch.termMonths, "words", key)}"`);
  }
  if (ch.renewal !== undefined) lines.push(`Section ${sec("term")}.2 is deleted and replaced with: "${sec("term")}.2 ${renewalSentence(ch.renewal, key)}"`);
  if (ch.noticeDays !== undefined) {
    lines.push(c.renewal.defined && c.renewal.kind === "auto"
      ? `Section ${sec("defs")} is amended so that "Non-Renewal Notice Period" means ${key(both(ch.noticeDays))} days.`
      : `In Section ${sec("term")}.2, the notice of non-renewal period is changed to ${key(both(ch.noticeDays))} days.`);
  }
  if (ch.cap !== undefined) lines.push(`Section ${sec("cap")}.2 is deleted and replaced with: "${sec("cap")}.2 ${capSentence(ch.cap, values.C, key)}"`);
  if (ch.law !== undefined) lines.push(`Section ${sec("law")}.1 is amended to read: "${sec("law")}.1 ${lawSentence(ch.law, key)}"`);
  return lines;
}

function amendmentText(a, c, sections, values, key) {
  const lines = amendmentLines(a, c, sections, values, key);
  const title = `AMENDMENT NO. ${a.number} TO ${a.toRestated ? "AMENDED AND RESTATED " : ""}${c.kind.toUpperCase()}`;
  const head = a.draft ? "DRAFT — FOR DISCUSSION ONLY — NOT FOR SIGNATURE\n" : "";
  const when = a.draft
    ? `Proposed by ${c.parties[1].short}, circulated ${longDate(a.effective)}.`
    : a.signedOn
      ? `This Amendment No. ${a.number} is signed on the dates below and takes effect on ${key(longDate(a.effective))}. Until then, the Agreement continues unchanged.`
      : `This Amendment No. ${a.number} is dated and effective ${key(longDate(a.effective))}.`;
  const sigDate = a.signedOn ?? a.effective;
  const signedLine = `/s/ Authorized Signatory   Date: ${longDate(sigDate)}`;
  const blankLine = "______________________   Date: __________";
  const signedByParty = (i) => (a.signed ? true : a.signedBy === i);
  const sigs = c.parties.map((p, i) => `${p.name.toUpperCase()}  By: ${signedByParty(i) ? signedLine : blankLine}`).join("\n");
  return `${head}${title}\n\n${when}\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n${lines.length + 1}. All other terms of the Agreement remain in full force and effect.\n\n${sigs}`;
}

/** The agreement the restated terms describe: the original with its restated clauses. */
const restatedAgreement = (c, r) => ({ ...c, term: { ...c.term, months: r.terms.termMonths }, renewal: r.terms.renewal, cap: r.terms.cap, law: r.terms.law });

/** An amended and restated agreement: a whole second agreement that supersedes the first and everything that amended it. */
function restatementText(r, c, sections, key) {
  const [p, q] = c.parties.map((x) => `${x.name}, ${x.entity} ("${x.short}")`);
  const opening = `This Amended and Restated ${c.kind} (this "Agreement") is entered into as of ${longDate(r.effective)} (the "Restatement Date") by and between ${p}, and ${q}. It amends and restates in its entirety the ${c.kind} between the parties that took effect on ${key(longDate(c.effective.date))}, as amended before the Restatement Date (the "Original Agreement"). From the Restatement Date, this Agreement supersedes the Original Agreement and every amendment to it, which are of no further effect. The "Effective Date" remains ${key(longDate(c.effective.date))}, and the Initial Term continues to run from it.`;
  const sigs = c.parties.map((p) => `${p.name.toUpperCase()}\nBy: /s/ Authorized Signatory\nDate: ${longDate(r.effective)}`).join("\n\n");
  return [
    `AMENDED AND RESTATED ${c.kind.toUpperCase()}\n\n${opening}`,
    ...sections.map(sectionText),
    `IN WITNESS WHEREOF, the parties have caused this Amended and Restated Agreement to be executed by their authorized representatives.\n\n${sigs}`,
  ].join("\n\n");
}

const RULE = "=".repeat(70);

const docName = (a, c) => (a.restates ? `Amended and Restated ${c.kind}` : `Amendment No. ${a.number}${a.toRestated ? " to the Amended and Restated Agreement" : ""}${a.draft ? " (draft)" : ""}`);

export function render(rng, c) {
  const kept = [];
  const key = (s) => {
    kept.push(s);
    return s;
  };
  const values = distractors(rng, c);
  const sections = body(rng, c, values, key);
  const restatement = c.amendments.find((a) => a.restates);
  const restated = restatement ? restatedAgreement(c, restatement) : null;
  const restatedSections = restated ? body(rng, restated, values, key) : null;
  const sowStarts = Array.from({ length: c.sowCount }, (_, i) => addDays(c.effective.date, 30 + 75 * i));
  const docs = [`${c.kind}`, "Schedules A–E", ...sowStarts.map((_, i) => `Statement of Work No. ${i + 1}`), ...c.amendments.map((a) => docName(a, c))];
  const amendmentDoc = (a) => (a.restates
    ? restatementText(a, c, restatedSections, key)
    : a.toRestated
      ? amendmentText(a, restated, restatedSections, values, key)
      : amendmentText(a, c, sections, values, key));
  const parts = [
    `PACKET STATUS DATE: ${longDate(c.statusDate)}\nDocuments in packet, in the order filed: ${docs.map((d, i) => `(${i + 1}) ${d}`).join("; ")}`,
    // The agreement is one document: its sections are separated by blank lines, not by the rule between documents.
    [
      `${c.kind.toUpperCase()}\n\n${preamble(c, key)}\n\nRECITALS. ${values.C} wishes to obtain, and ${values.P} wishes to provide, the services described in this Agreement on the terms set out below.`,
      ...sections.map(sectionText),
      `IN WITNESS WHEREOF, the parties have caused this Agreement to be executed by their authorized representatives.\n\n${signatureBlock(c, key)}`,
    ].join("\n\n"),
    ...schedules(rng, c, values),
    securitySchedule(rng, values),
    ...sowStarts.map((start, i) => sowText(rng, c, i + 1, start, values)),
    ...c.amendments.map(amendmentDoc),
  ];
  return { text: parts.join(`\n\n${RULE}\n\n`), protected: [...new Set(kept)] };
}
