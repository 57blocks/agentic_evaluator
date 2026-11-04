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

/**
 * R7: federal holidays (5 U.S.C. 6103(a)) as observed by federal employees:
 * one on a Saturday is observed the Friday before, one on a Sunday the Monday after.
 */
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return fromMs(Date.UTC(year, month - 1, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7));
}
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  return fromMs(last.getTime() - ((last.getUTCDay() - weekday + 7) % 7) * DAY);
}
function observed(iso) {
  const dow = new Date(toMs(iso)).getUTCDay();
  return dow === 6 ? addDays(iso, -1) : dow === 0 ? addDays(iso, 1) : iso;
}
export function federalHolidays(year) {
  const fixed = (month, day) => observed(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return new Set([
    fixed(1, 1), nthWeekday(year, 1, 1, 3), nthWeekday(year, 2, 1, 3), lastWeekday(year, 5, 1), fixed(6, 19),
    fixed(7, 4), nthWeekday(year, 9, 1, 1), nthWeekday(year, 10, 1, 2), fixed(11, 11), nthWeekday(year, 11, 4, 4), fixed(12, 25),
  ]);
}
export const isNonworkday = (iso) => {
  const dow = new Date(toMs(iso)).getUTCDay();
  return dow === 0 || dow === 6 || federalHolidays(Number(iso.slice(0, 4))).has(iso);
};
/** R7: a period whose last day is a Saturday, Sunday or federal holiday runs to the next workday. */
export function nextWorkday(iso) {
  let d = iso;
  while (isNonworkday(d)) d = addDays(d, 1);
  return d;
}

/**
 * R1: the anniversary of the Through date, before R7. The builders place
 * filing dates against this unrolled date (their dates fixed the v2.2 inputs);
 * the answer key uses correctedClaimDeadline / isTimely, which apply R7.
 */
export const filingDeadline = (through) => anniversary(through);
export const isTimely = (filed, through) => filed <= nextWorkday(filingDeadline(through));
/** R3 + R1 + R7: a new claim is due by the filing limit, rolled past a nonworkday. */
export const correctedClaimDeadline = (through) => nextWorkday(filingDeadline(through));

/**
 * R1: a timely-filing determination has no appeal rights (CFR 405.926(n)); the
 * remedy is a reopening, which a party may request "within 1 year from the date
 * of the initial determination … for any reason" (CFR 405.980(c)(1)). The
 * remittance carries the initial determination, so the deadline is its anniversary.
 */
export const reopeningDeadline = (remittance) => anniversary(remittance);
/**
 * R7 has no source for reopenings: when the anniversary is a nonworkday, the
 * next workday is accepted as well (see RULES.md).
 */
export const reopeningAlsoAccepted = (remittance) => {
  const rolled = nextWorkday(reopeningDeadline(remittance));
  return rolled === reopeningDeadline(remittance) ? [] : [rolled];
};

/** R2: 120 days from receipt, receipt presumed 5 days after the notice. */
export const REDETERMINATION_DAYS = 120;
export const PRESUMED_RECEIPT_DAYS = 5;
export const redeterminationDeadline = (remittance) => addDays(remittance, PRESUMED_RECEIPT_DAYS + REDETERMINATION_DAYS);
/** R2 + R7: the appeal deadline, rolled past a nonworkday. */
export const appealDeadline = (remittance) => nextWorkday(redeterminationDeadline(remittance));

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
