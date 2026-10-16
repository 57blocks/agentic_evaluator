/** RULES.md as code. Dates are ISO strings ("2025-03-15"); ISO dates compare as strings. */

const DAY = 86_400_000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, days) => fromMs(toMs(iso) + days * DAY);
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY);

/** R1: the anniversary of the Through date (the set never uses February 29). */
export function filingDeadline(through) {
  const [y, m, d] = through.split("-");
  return `${Number(y) + 1}-${m}-${d}`;
}
export const isTimely = (filed, through) => filed <= filingDeadline(through);

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
