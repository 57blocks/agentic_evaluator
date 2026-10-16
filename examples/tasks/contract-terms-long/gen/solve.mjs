/**
 * The answer key, as code. An agreement's terms as they stand on the packet's
 * status date: the base agreement, then every amendment that is signed by
 * both parties and effective on or before the status date, applied in order
 * of effective date (not filing order). Unsigned drafts and amendments that
 * take effect later change nothing.
 */

/** Amendments that bind on `statusDate`, oldest first. ISO dates compare as strings. */
export function inForce(amendments, statusDate) {
  return amendments.filter((a) => a.signed && a.effective <= statusDate).sort((a, b) => a.effective.localeCompare(b.effective));
}

/**
 * @param {object} c the generated agreement (see structures.mjs)
 * @returns the eight graded fields
 */
export function solve(c) {
  const base = {
    initial_term_months: c.term.months,
    renewal: c.renewal,
    governing_law: c.law,
    liability_cap: c.cap,
  };
  const current = inForce(c.amendments, c.statusDate).reduce((acc, a) => ({
    ...acc,
    ...(a.changes.termMonths !== undefined ? { initial_term_months: a.changes.termMonths } : {}),
    ...(a.changes.noticeDays !== undefined ? { renewal: { ...acc.renewal, noticeDays: a.changes.noticeDays } } : {}),
    ...(a.changes.cap !== undefined ? { liability_cap: a.changes.cap } : {}),
    ...(a.changes.law !== undefined ? { governing_law: a.changes.law } : {}),
  }), base);
  const isAuto = current.renewal.kind === "auto";
  return {
    parties: c.parties.map((p) => p.name),
    effective_date: c.effective.date,
    initial_term_months: current.initial_term_months,
    auto_renewal: isAuto,
    renewal_term_months: isAuto ? current.renewal.months : null,
    non_renewal_notice_days: isAuto ? current.renewal.noticeDays : null,
    governing_law: current.governing_law,
    liability_cap: capJson(current.liability_cap),
  };
}

function capJson(cap) {
  if (cap.type === "fixed") return { type: "fixed", amount_usd: cap.amount };
  if (cap.type === "fees_paid") return { type: "fees_paid", months: cap.months };
  return { type: cap.type, amount_usd: cap.amount, months: cap.months };
}
