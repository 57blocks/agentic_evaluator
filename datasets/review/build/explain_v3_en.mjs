/**
 * The English wording of explain_v3.mjs: the same steps, in the same order,
 * reaching the same deadlines and owners as the Chinese ones (explain_v3.mjs
 * checks both against the key).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const TASKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tasks");
const R = await import(`${TASKS}/claim-denials-snf-v2/gen/rules.mjs`);
const { controls, naturalPersons } = await import(`${TASKS}/kyc-ubo-v2/gen/solve.mjs`);

// ---------- claim-denials-snf-v3 ----------

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayNote = (iso) => `a ${DOW[dow(iso)]}${R.federalHolidays(Number(iso.slice(0, 4))).has(iso) ? " and a federal holiday" : ""}`;
function rolled(base) {
  const final = R.nextWorkday(base);
  return { final, text: final === base ? `${base} (${dayNote(base)}, a workday, so it stands)` : `${base} (${dayNote(base)}), so it runs to the next workday, ${final} (${dayNote(final)}; R7)` };
}
const appeal = (remit) => {
  const r = rolled(R.redeterminationDeadline(remit));
  return { deadline: r.final, step: `Deadline: remittance date ${remit} + 5 days presumed receipt + 120 days = ${r.text} (R2).` };
};
const filingLimit = (through) => rolled(R.filingDeadline(through));
const firstDate = (line) => line.slice(0, 10);
const datesIn = (line) => line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
const ASK = "Decide: root cause, correctable or not, next action, deadline.";

export const CLAIM_EXPLAIN_EN = {
  "duplicate-paid": (c) => ({
    question: `The remittance carries CAS*CO*18. ${ASK}`,
    deadline: null,
    steps: [
      "Adjustment code 18 = duplicate claim → root cause duplicate_claim.",
      `Facility records: the original claim was submitted ${firstDate(c.history[0])} and paid ${firstDate(c.history[1])}; the same claim was resubmitted unchanged on ${c.claim.filed} → it is a duplicate.`,
      "The original claim was paid, so nothing is owed on the resubmission → not correctable (no), next action write_off, no deadline (R6).",
    ],
  }),
  "late-filing": (c) => {
    const limit = filingLimit(c.claim.through);
    return {
      question: `The remittance carries CAS*CO*29. ${ASK}`,
      deadline: null,
      steps: [
        "Adjustment code 29 = time limit for filing expired → root cause timely_filing.",
        `The filing limit is one year from the Through date: Through ${c.claim.through} → last day ${limit.text} (R1).`,
        `The contractor received the claim on ${c.claim.filed}, after ${limit.final} → it was filed late. Exceptions to the limit (administrative error, retroactive entitlement and so on) are outside this dataset, and the file mentions none.`,
        "→ not correctable (no), next action write_off, no deadline.",
      ],
    };
  },
  unprocessable: (c) => {
    const limit = filingLimit(c.claim.through);
    return {
      question: `The remittance carries CAS*CO*16 with remark MA130. ${ASK}`,
      deadline: limit.final,
      steps: [
        `Code 16 with remark MA130 = missing or invalid information; the claim is unprocessable and has no appeal rights → root cause missing_or_invalid_information (R3). The facility's records give the edit: ${c.history[1].slice(12).replace(/^Claim edit report: /, "").replace(/\.$/, "")}.`,
        "Supplying the information and submitting again fixes it → correctable (yes), next action corrected_claim (a new claim), not an appeal.",
        `The new claim is still bound by the one-year filing limit: Through ${c.claim.through} → deadline ${limit.text} (R1, R3).`,
      ],
    };
  },
  "filing-through-date": (c) => {
    const limit = filingLimit(c.claim.through);
    const reopen = R.reopeningDeadline(c.remit.date);
    const also = R.reopeningAlsoAccepted(c.remit.date);
    return {
      question: `The remittance carries CAS*CO*29 (the contractor's stated reason: filed late), and a staff note says to write it off. ${ASK}`,
      deadline: reopen,
      also,
      steps: [
        "Adjustment code 29 = time limit for filing expired → root cause timely_filing.",
        `Counted from the From date (admission ${c.claim.from}), the receipt date ${c.claim.filed} is more than a year later; but an institutional claim spanning dates is counted from the Through date (R1, CPM Ch. 1 §70.1): Through ${c.claim.through} → last day ${limit.text}.`,
        `Received ${c.claim.filed}, not after ${limit.final} → the claim was timely and the contractor denied it in error → correctable (yes).`,
        "A timely-filing determination has no appeal rights (42 CFR 405.926(n)); the remedy is asking the contractor to reopen it, not an appeal (R1) → next action reopening.",
        `Deadline: one year from the date of the contractor's determination (the remittance date, ${c.remit.date}) = ${reopen} (${dayNote(reopen)}; 405.980(c)(1))${also.length ? `; that day is not a workday, and no source settles whether R7 applies to a reopening, so the next workday, ${also.join(", ")}, is accepted as well` : ""}.`,
      ],
    };
  },
  "new-benefit-period": (c) => {
    const [priorEnd, hospAdmit] = datesIn(c.history[1]);
    const a = appeal(c.remit.date);
    return {
      question: `The remittance carries CAS*PR*119 (benefit maximum reached). ${ASK}`,
      deadline: a.deadline,
      steps: [
        "Adjustment code 119 = benefit maximum reached → root cause benefit_limit_exhausted.",
        `The prior SNF stay ended ${priorEnd} with all 100 days of that benefit period used; from then until the hospital admission on ${hospAdmit} the beneficiary spent ${R.daysBetween(priorEnd, hospAdmit)} consecutive days out of hospital and SNF.`,
        `${R.BENEFIT_GAP_DAYS} or more consecutive days out ends the old benefit period; the admission on ${hospAdmit} starts a new one with 100 SNF days (R5) → the contractor denied in error → correctable (yes), next action appeal.`,
        a.step,
      ],
    };
  },
  "benefit-exhausted": (c) => {
    const used = Number(c.history[0].match(/days used in that benefit period: (\d+)/)[1]);
    const priorEnd = datesIn(c.history[0])[1];
    const hospAdmit = c.claim.qualifying.admitOrder;
    return {
      question: `The remittance carries CAS*PR*119 (benefit maximum reached), with some days paid. ${ASK}`,
      deadline: null,
      steps: [
        "Adjustment code 119 = benefit maximum reached → root cause benefit_limit_exhausted.",
        `The prior SNF stay ended ${priorEnd} with ${used} days used; the next hospital admission, ${hospAdmit}, came only ${R.daysBetween(priorEnd, hospAdmit)} days later (fewer than ${R.BENEFIT_GAP_DAYS}), so it is the same benefit period (R5).`,
        `That period has ${R.SNF_DAYS_PER_PERIOD - used} days left: from ${c.claim.from} they cover through ${c.remit.partial.paidThrough} (the remittance says days were paid through that date); the days after it, to ${c.claim.through}, are not covered by Medicare → not correctable (no).`,
        "The records say there is no other coverage (no Medigap, no Medicaid), and no SNFABN is given when Part A days are exhausted (CMS Ch. 30) → next action bill_patient, no deadline.",
      ],
    };
  },
  "qualifying-stay": (c) => {
    const { admitOrder, discharge } = c.claim.qualifying;
    const snfAdmit = c.claim.from;
    const a = appeal(c.remit.date);
    return {
      question: `The remittance carries CAS*CO*96, and the contractor says the 3-day qualifying stay was not met. ${ASK}`,
      deadline: a.deadline,
      steps: [
        "The contractor's stated reason is the qualifying 3-day stay → root cause qualifying_stay_not_met.",
        `Emergency and observation time is not inpatient time; inpatient days run from the admission order, ${admitOrder}, counting the admission day and not the discharge day: ${admitOrder} to ${discharge} = ${R.daysBetween(admitOrder, discharge)} days, at least 3 (R4).`,
        `Discharged ${discharge}, admitted to this facility ${snfAdmit}, ${R.daysBetween(discharge, snfAdmit)} days later (within 30) → the qualifying stay was met and the contractor denied in error → correctable (yes), next action appeal.`,
        a.step,
      ],
    };
  },
};

export const CLAIM_NOISE_EN = {
  "date-formats": (v) => {
    const [header, records] = v.split("+");
    return `mixed date formats: the header and remittance notes use ${header}, the facility records use ${records} (dates inside 835 segments are always CCYYMMDD)`;
  },
  "835-one-line": () => "the 835 segments run together on one line",
  "distractor-records": () => "a few day-to-day facility records that no rule reads",
  "missing-field": (v) => `one non-essential field is missing: ${{ "total-charges": "total charges", contractor: "the contractor's name", mbi: "the MBI" }[v]}`,
  ocr: () => "scan-style misspellings in header labels (names, dates and codes are untouched)",
};
export const KYC_NOISE_EN = {
  "date-formats": (v) => `dates written another way (${{ iso: "like 2026-03-05", "d. monat yyyy": "like 5. März 2026", "d.m.yyyy": "like 5.3.2026" }[v]})`,
  "amount-formats": (v) => `amounts written another way (${{ "eur-prefix": "like EUR 12.250,00", euro: "like 12.250,00 €", "dash-cents": "like 12.250,– EUR" }[v]})`,
  "table-layout": (v) => `the shareholder table is not aligned (separated by ${v})`,
  "distractor-entries": () => "register entries that have nothing to do with beneficial ownership (object of the company, change of seat and so on)",
  "missing-detail": (v) => `one non-essential detail is missing: ${{ "birth-dates": "birth dates", "list-date": "the date of the shareholder list", "register-numbers": "the holding companies' HRB numbers" }[v]}`,
  ocr: () => "scan-style misspellings in labels (names and amounts are untouched)",
};
export const NO_NOISE_EN = "none (clean input)";

// ---------- kyc-ubo-v3 ----------

const eur = (n) => `${n.toLocaleString("de-DE")} €`;
const pct = (part, base) => `${((part / base) * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
const votes = (h) => (h.voting === false ? 0 : h.nominal);
const total = (list, f = (h) => h.nominal) => list.reduce((s, h) => s + f(h), 0);
const overQuarter = (part, base) => base > 0 && part * 4 > base;

function describeEntity(name, entities) {
  const e = entities[name];
  const base = total(e.holders, votes);
  const shares = e.holders.map((h) => `${h.holder} ${pct(votes(h), base)}`).join(", ");
  const persons = [...new Set(e.holders.filter((h) => h.person).map((h) => h.holder))];
  const controller = persons.find((p) => controls(p, name, entities));
  return controller
    ? `Shares in ${name} (one vote per euro unless the articles say otherwise): ${shares} → ${controller} has more than 50% and controls ${name} (R5).`
    : `Shares in ${name} (one vote per euro unless the articles say otherwise): ${shares} → nobody has more than 50%, so nobody controls it, and under R5 the shares it holds in the company above are attributed to no one.`;
}

/** One person's line, and whether it counts them. */
function personLine(person, target, entities) {
  const t = entities[target];
  const direct = t.holders.filter((h) => h.person && h.holder === person);
  const via = t.holders.filter((h) => !h.person && controls(person, h.holder, entities, new Set([target])));
  const capBase = total(t.holders);
  const voteBase = total(t.holders, votes);
  const cap = total(direct) + total(via);
  const vote = total(direct, votes) + total(via, votes);
  const parts = [
    ...(direct.length ? [`holds ${eur(total(direct))} directly${direct.length > 1 ? ` (${direct.length} shares added, R2)` : ""}`] : []),
    ...via.map((h) => `${eur(h.nominal)} through ${h.holder}, which this person controls (in full, R3${via.length > 1 ? ", R4" : ""})`),
  ];
  const gp = t.generalPartner && controls(person, t.generalPartner, entities);
  if (parts.length === 0 && !gp) return { counted: false, line: `${person}: no share in ${target} is attributable to this person → not an owner.` };
  if (parts.length === 0) return { counted: true, line: `${person}: holds no share in ${target} directly, but controls its general partner ${t.generalPartner}, which alone manages the KG → an owner (R7).` };
  const capText = parts.length ? `${parts.join("; ")}; capital ${eur(cap)} / ${eur(capBase)} = ${pct(cap, capBase)}` : "";
  const voteText = (parts.length && vote !== cap) || (parts.length && voteBase !== capBase) ? `; votes (voting shares only) ${eur(vote)} / ${eur(voteBase)} = ${pct(vote, voteBase)}` : "";
  const [counted, verdict] = overQuarter(cap, capBase)
    ? [true, "more than 25% of the capital → an owner (R1)"]
    : parts.length && overQuarter(vote, voteBase)
      ? [true, "more than 25% of the votes → an owner (R1)"]
      : gp
        ? [true, `controls the general partner ${t.generalPartner}, which alone manages the KG → an owner (R7)`]
        : [false, "not more than 25% of capital or of votes → not an owner"];
  return { counted, line: `${person}: ${capText}${voteText} → ${verdict}.` };
}

export function explainKycItemEn(structure, register) {
  const { target, entities, legalReps } = structure;
  const t = entities[target];
  const steps = [];
  if (t.ownShares) steps.push(`${target} holds ${eur(t.ownShares)} of its own shares, which are left out of the base: capital base = ${eur(t.capital)} − ${eur(t.ownShares)} = ${eur(total(t.holders))} (R6).`);
  if (t.holders.some((h) => h.voting === false)) {
    const mute = t.holders.filter((h) => h.voting === false).map((h) => `${h.holder} ${eur(h.nominal)}`).join(", ");
    steps.push(`Non-voting shares: ${mute}; vote base (voting shares only) = ${eur(total(t.holders, votes))}. More than 25% of either capital or votes makes an owner (R1).`);
  }
  for (const name of Object.keys(entities).filter((n) => n !== target)) steps.push(describeEntity(name, entities));
  const lines = naturalPersons(entities).map((p) => ({ p, ...personLine(p, target, entities) }));
  steps.push(...lines.map((x) => x.line));
  const counted = lines.filter((x) => x.counted).map((x) => x.p);
  if (counted.length === 0) {
    const reps = register.kg ? legalReps.join(", ") : register.managers.join(", ");
    const prokura = register.prokura.length ? `; the Prokurist ${register.prokura.join(", ")} is not a legal representative and does not count` : "";
    steps.push(`Nobody qualifies → no beneficial owners; the fictitious beneficial owners are the legal representatives (Geschäftsführer): ${reps}${prokura} (R8).`);
  } else {
    steps.push(`→ Beneficial owners: ${counted.join(", ")}; someone qualifies, so there are no fictitious beneficial owners.`);
  }
  return {
    question: `Find the beneficial owners of ${target} (natural persons who directly or indirectly hold more than 25% of the capital or votes, or control it otherwise); if nobody qualifies, give the fictitious beneficial owners.`,
    steps,
    counted,
    fallbackNames: counted.length === 0 ? (register.kg ? legalReps : register.managers) : [],
  };
}
