/**
 * One builder per kind of case. Each sets up a Medicare Part A SNF claim, its
 * remittance and the records a biller would have, and computes the answer
 * through rules.mjs, so an answer always follows from RULES.md.
 */

import { addDays, filingDeadline, inpatientDays, newBenefitPeriod, qualifyingStayMet, redeterminationDeadline, reopeningDeadline, SNF_DAYS_PER_PERIOD } from "./rules.mjs";

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** A date in [from, to], never February 29 (R1's anniversary rule). */
function dateIn(rng, from, to) {
  for (;;) {
    const d = addDays(from, int(rng, 0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)));
    if (!d.endsWith("-02-29")) return d;
  }
}

/** A stay of `days` days starting `from`: Through is the last day billed. */
const stay = (from, days) => ({ from, through: addDays(from, days - 1) });

const answer = (root_cause, correctable, next_action, deadline) => ({ root_cause, correctable, next_action, deadline });

export const ARCHETYPES = {
  "duplicate-paid": {
    tags: ["normal"],
    build: (rng) => {
      const s = stay(dateIn(rng, "2025-01-05", "2025-06-30"), int(rng, 12, 30));
      const filed = addDays(s.through, int(rng, 5, 20));
      const paidOn = addDays(filed, int(rng, 14, 25));
      const resent = addDays(paidOn, int(rng, 3, 10));
      return {
        claim: { ...s, filed: resent },
        remit: { date: addDays(resent, int(rng, 10, 20)), group: "CO", carc: 18 },
        history: [`${filed}  Original claim submitted.`, `${paidOn}  Original claim PAID (ICN on remittance of that date).`, `${resent}  Same claim resubmitted by billing staff in error (no changes).`],
        expected: answer("duplicate_claim", "no", "write_off", null),
      };
    },
  },
  "late-filing": {
    tags: ["normal"],
    build: (rng) => {
      const s = stay(dateIn(rng, "2024-01-05", "2024-06-30"), int(rng, 15, 30));
      const filed = addDays(filingDeadline(s.through), int(rng, 6, 60));
      return {
        claim: { ...s, filed },
        remit: { date: addDays(filed, int(rng, 10, 25)), group: "CO", carc: 29 },
        history: [`${addDays(s.through, 20)}  Claim held: physician certification missing.`, `${addDays(filed, -3)}  Certification found in archive; claim released.`, `${filed}  Claim submitted (first submission to the MAC).`],
        expected: answer("timely_filing", "no", "write_off", null),
      };
    },
  },
  unprocessable: {
    tags: ["normal", "ma130"],
    build: (rng) => {
      const s = stay(dateIn(rng, "2025-02-01", "2025-07-31"), int(rng, 10, 28));
      const filed = addDays(s.through, int(rng, 5, 30));
      const remitDate = addDays(filed, int(rng, 7, 20));
      return {
        claim: { ...s, filed },
        remit: { date: remitDate, group: "CO", carc: 16, remark: "MA130" },
        history: [`${filed}  Claim submitted.`, `${addDays(filed, 2)}  Claim edit report: ${pick(rng, ["attending physician NPI missing", "occurrence code 50 date missing", "value code 80 (covered days) missing", "patient discharge status code missing"])}.`],
        expected: answer("missing_or_invalid_information", "yes", "corrected_claim", filingDeadline(s.through)),
      };
    },
  },
  "filing-through-date": {
    tags: ["hard", "contractor-error", "span-dates"],
    build: (rng) => {
      // A long stay: filed more than a year after From, within a year of Through.
      const s = stay(dateIn(rng, "2024-06-01", "2024-08-31"), int(rng, 45, 80));
      const filed = addDays(filingDeadline(s.through), -int(rng, 2, 25));
      const remitDate = addDays(filed, int(rng, 10, 20));
      return {
        claim: { ...s, filed },
        remit: { date: remitDate, group: "CO", carc: 29 },
        history: [`${addDays(s.through, 30)}  Claim held for therapy minutes reconciliation.`, `${filed}  Claim submitted.`, `${addDays(remitDate, 1)}  Staff note: "Denied as late. Admission was over a year before we billed, so we probably have to write it off."`],
        expected: answer("timely_filing", "yes", "reopening", reopeningDeadline(remitDate)),
      };
    },
  },
  "new-benefit-period": {
    tags: ["hard", "contractor-error", "benefit-period"],
    build: (rng) => {
      const priorEnd = dateIn(rng, "2024-10-01", "2025-01-31");
      const gap = int(rng, 75, 140);
      const hospAdmit = addDays(priorEnd, gap);
      const hospDischarge = addDays(hospAdmit, int(rng, 3, 6));
      const s = stay(hospDischarge, int(rng, 20, 30));
      const remitDate = addDays(s.through, int(rng, 20, 40));
      if (!newBenefitPeriod(priorEnd, hospAdmit)) throw new Error("new-benefit-period builder produced a short gap");
      return {
        claim: { ...s, filed: addDays(s.through, 8), qualifying: { admitOrder: hospAdmit, discharge: hospDischarge } },
        remit: { date: remitDate, group: "PR", carc: 119 },
        history: [`Prior SNF stay at this facility: ${addDays(priorEnd, -int(rng, 70, 95))} to ${priorEnd} (Medicare days used in that benefit period: 100).`, `No hospital or SNF care between ${priorEnd} and ${hospAdmit} (beneficiary at home; confirmed with family and the hospital).`, `Hospital inpatient ${hospAdmit} to ${hospDischarge}; admitted here ${hospDischarge}.`],
        expected: answer("benefit_limit_exhausted", "yes", "appeal", redeterminationDeadline(remitDate)),
      };
    },
  },
  "benefit-exhausted": {
    tags: ["hard", "benefit-period"],
    build: (rng) => {
      const used = int(rng, 70, 92);
      const priorEnd = dateIn(rng, "2025-01-10", "2025-04-30");
      const hospAdmit = addDays(priorEnd, int(rng, 12, 40));
      const hospDischarge = addDays(hospAdmit, int(rng, 3, 5));
      // The stay runs 5-15 days past day 100, so some days are genuinely uncovered.
      const s = stay(hospDischarge, SNF_DAYS_PER_PERIOD - used + int(rng, 5, 15));
      if (newBenefitPeriod(priorEnd, hospAdmit)) throw new Error("benefit-exhausted builder produced a long gap");
      const lastCovered = addDays(s.from, SNF_DAYS_PER_PERIOD - used - 1);
      if (lastCovered >= s.through) throw new Error("benefit-exhausted builder left no uncovered days");
      return {
        claim: { ...s, filed: addDays(s.through, 8), qualifying: { admitOrder: hospAdmit, discharge: hospDischarge } },
        remit: { date: addDays(s.through, int(rng, 20, 35)), group: "PR", carc: 119, partial: { paidThrough: lastCovered } },
        history: [`Prior SNF stay at this facility: ${addDays(priorEnd, -used + 1)} to ${priorEnd} (Medicare days used in that benefit period: ${used}).`, `Beneficiary at home ${addDays(priorEnd, 1)} to ${addDays(hospAdmit, -1)}.`, `Hospital inpatient ${hospAdmit} to ${hospDischarge}; admitted here ${hospDischarge}.`, "Other coverage on file: none (no Medigap, no Medicaid)."],
        expected: answer("benefit_limit_exhausted", "no", "bill_patient", null),
      };
    },
  },
  "qualifying-stay": {
    tags: ["hard", "contractor-error", "three-day-stay"],
    build: (rng) => {
      const ed = dateIn(rng, "2025-02-01", "2025-07-31");
      const obsDays = int(rng, 1, 2);
      const admitOrder = addDays(ed, obsDays);
      const discharge = addDays(admitOrder, 3);
      const snfAdmit = addDays(discharge, int(rng, 0, 1) === 0 ? 0 : int(rng, 20, 29));
      const q = { admitOrder, discharge, snfAdmit };
      if (!qualifyingStayMet(q) || inpatientDays(admitOrder, discharge) !== 3) throw new Error("qualifying-stay builder broke R4");
      const s = stay(snfAdmit, int(rng, 14, 28));
      const remitDate = addDays(s.through, int(rng, 15, 30));
      return {
        claim: { ...s, filed: addDays(s.through, 6), qualifying: { admitOrder, discharge } },
        remit: { date: remitDate, group: "CO", carc: 96, contractorReason: "Qualifying 3-day inpatient hospital stay requirement not met." },
        history: [`Hospital record: emergency department ${ed}; observation ${ed} to ${admitOrder}; inpatient admission order signed ${admitOrder}; discharged ${discharge}.`, snfAdmit === discharge ? `Admitted here ${snfAdmit}, directly from the hospital.` : `Discharged home ${discharge}; admitted here ${snfAdmit} for skilled therapy related to the hospital stay.`],
        expected: answer("qualifying_stay_not_met", "yes", "appeal", redeterminationDeadline(remitDate)),
      };
    },
  },
};

/** How many of each kind make up the set (30 items). */
export const QUOTA = { "duplicate-paid": 3, "late-filing": 3, unprocessable: 5, "filing-through-date": 5, "new-benefit-period": 5, "benefit-exhausted": 4, "qualifying-stay": 5 };
