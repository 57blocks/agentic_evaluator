/** RULES.md as code. Dates are ISO strings ("2025-03-15"); ISO dates compare as strings. */

const DAY = 86_400_000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, days) => fromMs(toMs(iso) + days * DAY);
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY);

/** One calendar year on: the same month and day next year (the set never uses February 29). */
function anniversary(iso) {
  const [y, m, d] = iso.split("-");
  return `${Number(y) + 1}-${m}-${d}`;
}

/** R1: the anniversary of the Through date. */
export const filingDeadline = (through) => anniversary(through);
export const isTimely = (filed, through) => filed <= filingDeadline(through);

/**
 * R1: a timely-filing determination has no appeal rights (CFR 405.926(n)); the
 * remedy is a reopening, which a party may request "within 1 year from the date
 * of the initial determination … for any reason" (CFR 405.980(c)(1)). The
 * remittance carries the initial determination, so the deadline is its anniversary.
 */
export const reopeningDeadline = (remittance) => anniversary(remittance);

/** R2: 120 days from receipt, receipt presumed 5 days after the notice. */
export const REDETERMINATION_DAYS = 120;
export const PRESUMED_RECEIPT_DAYS = 5;
export const redeterminationDeadline = (remittance) => addDays(remittance, PRESUMED_RECEIPT_DAYS + REDETERMINATION_DAYS);

/** R4: inpatient days count the admission day, not the discharge day. */
export const QUALIFYING_DAYS = 3;
export const SNF_ADMIT_WINDOW_DAYS = 30;
export const inpatientDays = (admitOrder, discharge) => daysBetween(admitOrder, discharge);
export const qualifyingStayMet = ({ admitOrder, discharge, snfAdmit }) =>
  inpatientDays(admitOrder, discharge) >= QUALIFYING_DAYS && daysBetween(discharge, snfAdmit) <= SNF_ADMIT_WINDOW_DAYS;

/** R5: a benefit period ends after 60 consecutive days out of hospital and SNF. */
export const BENEFIT_GAP_DAYS = 60;
export const SNF_DAYS_PER_PERIOD = 100;
export const newBenefitPeriod = (lastDischarge, nextAdmit) => daysBetween(lastDischarge, nextAdmit) >= BENEFIT_GAP_DAYS;
