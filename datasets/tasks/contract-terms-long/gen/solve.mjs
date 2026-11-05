/**
 * The answer key, as code. An agreement's terms as they stand on the packet's
 * status date: the base agreement, then every amendment that is signed by
 * both parties and effective on or before the status date, applied in order
 * of effective date (not filing order). An amended and restated agreement
 * replaces everything before it. Unsigned drafts, amendments one party did
 * not sign, and amendments that take effect later change nothing. A clause
 * the agreement does not have is null. RULES.md states each rule.
 */

/** Amendments that bind on `statusDate`, oldest first. ISO dates compare as strings. */
export function inForce(amendments, statusDate) {
  return amendments.filter((a) => a.signed && a.effective <= statusDate).sort((a, b) => a.effective.localeCompare(b.effective));
}

/** The terms after one binding amendment (or restatement) is applied to `acc`. */
function apply(acc, a) {
  if (a.restates) return { term: a.terms.termMonths, renewal: a.terms.renewal, law: a.terms.law, cap: a.terms.cap };
  const ch = a.changes;
  const renewal = ch.renewal !== undefined ? ch.renewal : ch.noticeDays !== undefined ? { ...acc.renewal, noticeDays: ch.noticeDays } : acc.renewal;
  return {
    term: ch.termMonths !== undefined ? ch.termMonths : acc.term,
    renewal,
    law: ch.law !== undefined ? ch.law : acc.law,
    cap: ch.cap !== undefined ? ch.cap : acc.cap,
  };
}

/** The terms as they stand on the status date. */
export function current(c) {
  const base = { term: c.term ? c.term.months : null, renewal: c.renewal, law: c.law, cap: c.cap };
  return inForce(c.amendments, c.statusDate).reduce(apply, base);
}

/**
 * @param {object} c the generated agreement (see structures.mjs)
 * @returns the eight graded fields, and `why`: what decided them (not graded)
 */
export function solve(c) {
  const now = current(c);
  const isAuto = now.renewal.kind === "auto";
  return {
    parties: c.parties.map((p) => p.name),
    effective_date: c.effective.date,
    initial_term_months: now.term,
    auto_renewal: isAuto,
    renewal_term_months: isAuto ? now.renewal.months : null,
    non_renewal_notice_days: isAuto ? now.renewal.noticeDays : null,
    governing_law: now.law,
    liability_cap: now.cap ? capJson(now.cap) : null,
    why: explain(c),
  };
}

function capJson(cap) {
  if (cap.type === "fixed") return { type: "fixed", amount_usd: cap.amount };
  if (cap.type === "fees_paid") return { type: "fees_paid", months: cap.months };
  return { type: cap.type, amount_usd: cap.amount, months: cap.months };
}

const capWords = (cap) => (cap === null ? "none" : cap.type === "fixed" ? `fixed $${cap.amount}` : cap.type === "fees_paid" ? `fees of ${cap.months} months` : `${cap.type.replace("_", " ")} $${cap.amount} / fees of ${cap.months} months`);
const renewalWords = (r) => (r.kind === "auto" ? `auto-renews ${r.months} months, ${r.noticeDays} days' notice` : r.kind === "mutual" ? "renews only by mutual agreement" : "no renewal");
const changeWords = (ch) => Object.entries(ch).filter(([k]) => k !== "termStyle").map(([k, v]) => (k === "cap" ? `cap ${capWords(v)}` : k === "renewal" ? renewalWords(v) : k === "termMonths" ? `initial term ${v} months` : k === "noticeDays" ? `notice ${v} days` : `law ${v}`)).join(", ");

/** One line per document that could change the terms, saying whether it did. Written for a reviewer, never graded. */
function explain(c) {
  const lines = [];
  const effective = { as_of: "stated as of", defined: "a defined term", last_signature: "the later signature date" }[c.effective.style];
  lines.push(`Effective date ${c.effective.date} (${effective}).`);
  const base = `Base agreement: ${c.term ? `${c.term.months}-month initial term${c.term.style === "end_date" ? " (given as an end date)" : ""}` : "no fixed term"}; ${renewalWords(c.renewal)}; law ${c.law ?? "not stated (the venue clause names a state, which is not governing law)"}; cap ${c.cap === null ? "not stated (no general cap; nothing to fill in)" : capWords(c.cap)}.`;
  lines.push(base);
  const binding = new Set(inForce(c.amendments, c.statusDate));
  const bySequence = [...c.amendments].sort((a, b) => a.effective.localeCompare(b.effective));
  let restated = false;
  for (const a of bySequence) {
    const name = a.restates ? `Amended and Restated Agreement (${a.effective})` : `Amendment No. ${a.number}${a.toRestated ? " to the restated agreement" : ""} (${a.effective})`;
    if (a.restates) {
      restated = true;
      lines.push(`${name}: supersedes the original and every earlier amendment; restates ${changeWords({ cap: a.terms.cap, law: a.terms.law, renewal: a.terms.renewal })}.`);
    } else if (!binding.has(a)) {
      const reason = a.draft ? "unsigned draft" : a.signedBy !== undefined ? "signed by one party only" : a.effective > c.statusDate ? `takes effect ${a.effective}, after the status date` : "not binding";
      lines.push(`${name}: ${reason}; changes nothing (would set ${changeWords(a.changes)}).`);
    } else if (restated && !a.toRestated) {
      lines.push(`${name}: executed, but superseded by the restatement.`);
    } else {
      lines.push(`${name}: executed; sets ${changeWords(a.changes)}.`);
    }
  }
  if (c.amendments.length > 1) lines.push("Amendments apply in order of effective date, not the order filed.");
  lines.push(`Each SOW's own term, cap and governing law apply to that SOW only; none overrides the agreement. Status date ${c.statusDate}.`);
  return lines.join(" ");
}
