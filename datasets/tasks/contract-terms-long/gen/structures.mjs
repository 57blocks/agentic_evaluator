/**
 * What one agreement says: parties, dates, the graded terms, distractor
 * numbers, an SOW that does not override the agreement, and (for the trap
 * items) a set of amendments, or clauses left out. solve.mjs reads this to
 * grade; render.mjs writes it out as a document packet.
 *
 * Every random draw a trap needs happens inside its TRAPS entry, after the
 * base agreement is built, so adding a trap kind never changes the items
 * generated before it (the rng is one stream across the set).
 */

import { addDays, termEnd } from "./words.mjs";

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export function shuffled(rng, list) {
  return list.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

export const STATUS_DATE = "2026-10-01";

const STATES = ["Delaware", "New York", "California", "Texas", "Illinois", "Colorado", "Washington", "Massachusetts", "Georgia", "Ohio", "Minnesota", "Virginia", "Florida", "Oregon"];
const COMPANY_STEMS = ["Northwind", "Larkspur", "Quillstone", "Halvorsen", "Brightwater", "Meridian", "Cobalt Ridge", "Fernhill", "Saltmarsh", "Kitebridge", "Ashgrove", "Pellucid", "Corvane", "Delmont", "Lumenfield", "Granite Peak", "Sablewood", "Tidewater", "Brookhaven", "Ironleaf", "Marlow", "Tessellate", "Orchard Row", "Silverbirch", "Copperline", "Harborview", "Stonegate", "Wrenfield"];
const TRADES = ["Analytics", "Foods", "Systems", "Supply", "Logistics", "Media", "Health Partners", "Software", "Manufacturing", "Home Goods", "Biologics", "Lab Services", "Freight", "Retail Holdings", "Digital", "Outdoor", "Security Group", "Data Services", "Energy"];
const FORMS = [["Inc.", "corporation"], ["LLC", "limited liability company"], ["Corp.", "corporation"], ["Co.", "corporation"], ["Holdings, Inc.", "corporation"], ["LLP", "limited liability partnership"]];
const ROLES = [["Provider", "Customer"], ["Vendor", "Client"], ["Supplier", "Buyer"], ["Contractor", "Company"], ["Consultant", "Client"]];
const KINDS = ["Master Services Agreement", "Professional Services Agreement", "Software Services Agreement", "Managed Services Agreement", "Technology Services Agreement"];
const NOTICE_POOL = [30, 45, 60, 75, 90, 120];

function party(rng, used, role) {
  for (;;) {
    const [suffix, form] = pick(rng, FORMS);
    const name = `${pick(rng, COMPANY_STEMS)} ${pick(rng, TRADES)} ${suffix}`;
    // "Retail Holdings Holdings, Inc." reads as a generator slip; draw again.
    if (!used.has(name) && !name.includes("Holdings Holdings")) {
      used.add(name);
      return { name, short: role, entity: `a ${pick(rng, STATES)} ${form}` };
    }
  }
}

function isoBetween(rng, from, to) {
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return addDays(from, int(rng, 0, span));
}

function cap(rng) {
  const amount = pick(rng, [500000, 750000, 1000000, 1500000, 2000000, 2500000, 3000000]);
  const months = pick(rng, [6, 12, 18, 24]);
  return pick(rng, [
    { type: "fixed", amount },
    { type: "fees_paid", months },
    { type: "greater_of", amount, months },
    { type: "lesser_of", amount, months },
  ]);
}

function renewal(rng) {
  const roll = rng();
  if (roll < 0.7) return { kind: "auto", months: pick(rng, [12, 12, 24, 6]), noticeDays: pick(rng, [30, 45, 60, 90, 120, 180]), defined: rng() < 0.3 };
  if (roll < 0.85) return { kind: "mutual", months: pick(rng, [12, 24]), daysBefore: pick(rng, [30, 60, 90]) };
  return { kind: "none" };
}

/** A plain automatic renewal, as an amendment adds it. */
const autoRenewal = (rng) => ({ kind: "auto", months: pick(rng, [12, 24, 6]), noticeDays: pick(rng, NOTICE_POOL), defined: false });

function amendment(number, effective, signed, changes) {
  return { number, effective, signed, changes };
}

/** An amendment one party signed and the other did not: it binds nothing, however it is dated. */
const onePartyAmendment = (rng, number, effective, changes) => ({ ...amendment(number, effective, false, changes), signedBy: int(rng, 0, 1) });

/** A value different from `current`, from `options` (equality by JSON). */
function other(rng, current, options) {
  const different = options.filter((o) => JSON.stringify(o) !== JSON.stringify(current));
  return different.length > 0 ? pick(rng, different) : options[0];
}

/** The one field an amendment most naturally touches: the notice period when the agreement auto-renews, the cap otherwise. */
function usualChange(rng, c, current) {
  return c.renewal.kind === "auto"
    ? { noticeDays: other(rng, current.noticeDays ?? c.renewal.noticeDays, NOTICE_POOL) }
    : { cap: other(rng, current.cap ?? c.cap, [cap(rng)]) };
}

/**
 * The structural traps, each a set of amendments in the order they are filed.
 * Each returns amendments for the agreement `c`; solve.mjs decides what they do.
 */
const TRAPS = {
  none: () => [],
  "executed-amendment": (rng, c) => [amendment(1, isoBetween(rng, addDays(c.effective.date, 120), "2026-08-31"), true, c.renewal.kind === "auto" ? { noticeDays: other(rng, c.renewal.noticeDays, [30, 45, 60, 90, 120]) } : { cap: other(rng, c.cap, [cap(rng)]) })],
  "draft-amendment": (rng, c) => [{ ...amendment(1, isoBetween(rng, "2026-05-01", "2026-09-15"), false, { law: other(rng, c.law, STATES), cap: cap(rng) }), draft: true }],
  "future-amendment": (rng, c) => [{ ...amendment(1, pick(rng, ["2027-01-01", "2026-12-01", "2027-04-01"]), true, { cap: cap(rng), law: other(rng, c.law, STATES) }), signedOn: isoBetween(rng, "2026-08-01", "2026-09-25") }],
  "out-of-order": (rng, c) => {
    const first = isoBetween(rng, addDays(c.effective.date, 90), "2025-06-30");
    const second = isoBetween(rng, addDays(first, 60), "2026-08-31");
    const field = c.renewal.kind === "auto" ? "noticeDays" : "cap";
    const value = () => (field === "noticeDays" ? pick(rng, [30, 45, 60, 75, 90, 120]) : cap(rng));
    const [a, b] = [value(), value()];
    // Filed newest first: a reader who takes the last one in the packet gets it wrong.
    return [amendment(2, second, true, { [field]: other(rng, a, [b, value()]) }), amendment(1, first, true, { [field]: a })];
  },
  /** Dated and effective like any other, but only one party signed it. */
  "one-party": (rng, c) => [onePartyAmendment(rng, 1, isoBetween(rng, addDays(c.effective.date, 120), "2026-08-31"), usualChange(rng, c, {}))],
  /**
   * Three executed amendments, the first and third on the same field, and a
   * fourth that binds nothing (a draft, a future-effective one or a one-party
   * one), filed in random order.
   */
  chain: (rng, c) => {
    const d1 = isoBetween(rng, addDays(c.effective.date, 60), "2025-03-31");
    const d2 = isoBetween(rng, addDays(d1, 45), "2025-12-31");
    const d3 = isoBetween(rng, addDays(d2, 45), "2026-08-31");
    const first = usualChange(rng, c, {});
    const second = { cap: other(rng, first.cap ?? c.cap, [cap(rng)]), law: other(rng, c.law, STATES) };
    const third = usualChange(rng, c, { noticeDays: first.noticeDays, cap: second.cap });
    const executed = [amendment(1, d1, true, first), amendment(2, d2, true, second), amendment(3, d3, true, third)];
    const kind = pick(rng, ["draft", "future", "one-party"]);
    const fourth = kind === "draft"
      ? { ...amendment(4, isoBetween(rng, "2026-06-01", "2026-09-20"), false, { cap: other(rng, third.cap ?? second.cap, [cap(rng)]) }), draft: true }
      : kind === "future"
        ? { ...amendment(4, pick(rng, ["2026-12-01", "2027-01-01"]), true, { law: other(rng, second.law, STATES) }), signedOn: isoBetween(rng, "2026-08-01", "2026-09-25") }
        : onePartyAmendment(rng, 4, isoBetween(rng, addDays(d3, 20), "2026-09-20"), { cap: other(rng, third.cap ?? second.cap, [cap(rng)]) });
    return shuffled(rng, [...executed, fourth]);
  },
  /**
   * An executed amendment, then an amended and restated agreement that
   * supersedes the original and that amendment, then an amendment to the
   * restated agreement (executed, or a draft). Filed in order half the time.
   */
  restated: (rng, c) => {
    const d1 = isoBetween(rng, addDays(c.effective.date, 90), "2025-04-30");
    const rd = isoBetween(rng, addDays(d1, 60), "2026-03-31");
    const d2 = isoBetween(rng, addDays(rd, 30), "2026-09-15");
    const pre = amendment(1, d1, true, usualChange(rng, c, {}));
    const terms = {
      termMonths: c.term.months,
      renewal: c.renewal.kind === "auto"
        ? { ...c.renewal, noticeDays: other(rng, pre.changes.noticeDays, NOTICE_POOL.filter((n) => n !== c.renewal.noticeDays)), defined: false }
        : c.renewal,
      cap: other(rng, pre.changes.cap ?? c.cap, [cap(rng), cap(rng), cap(rng)]),
      law: other(rng, c.law, STATES),
    };
    const restatement = { number: 0, restates: true, effective: rd, signed: true, terms, changes: {} };
    const postChange = pick(rng, [
      () => ({ law: other(rng, terms.law, STATES) }),
      () => ({ cap: other(rng, terms.cap, [cap(rng)]) }),
      () => (terms.renewal.kind === "auto" ? { noticeDays: other(rng, terms.renewal.noticeDays, NOTICE_POOL) } : { cap: other(rng, terms.cap, [cap(rng)]) }),
    ])();
    const post = rng() < 0.65
      ? { ...amendment(1, d2, true, postChange), toRestated: true }
      : { ...amendment(1, d2, false, postChange), toRestated: true, draft: true };
    const filed = [pre, restatement, post];
    return rng() < 0.5 ? filed : shuffled(rng, filed);
  },
  /**
   * One executed amendment that changes the renewal itself, or the length of
   * the initial term. The variants take turns (a counter, not the rng), so a
   * small quota still covers each.
   */
  "renewal-amendment": (rng, c) => {
    const when = isoBetween(rng, addDays(c.effective.date, 120), "2026-08-31");
    const extend = () => ({ termMonths: c.term.months + pick(rng, [12, 24]), termStyle: pick(rng, ["words", "end_date"]) });
    const replace = () => (c.renewal.kind === "auto" && !c.renewal.defined ? { renewal: { kind: "none" } } : { renewal: autoRenewal(rng) });
    const resize = () => (c.renewal.kind === "auto" && !c.renewal.defined ? { renewal: { ...c.renewal, months: other(rng, c.renewal.months, [6, 12, 24, 36]) } } : extend());
    const variants = [replace, extend, resize];
    return [amendment(1, when, true, variants[turn.renewal++ % variants.length]())];
  },
  /** No amendments: the trap is a clause the agreement does not have. */
  absent: () => [],
};

export const TRAP_KINDS = Object.keys(TRAPS);

/** Trap variants that take turns rather than drawing from the rng, so each shows up under a small quota. */
const turn = { renewal: 0, absent: 0 };
const ABSENT_CYCLE = [["law"], ["cap"], ["term"], ["law", "cap"], ["cap", "term"], ["law"]];

/** Which clauses an `absent` item leaves out: governing law (a venue still names a state), the general cap, or a fixed term. */
function dropClauses(c) {
  const missing = ABSENT_CYCLE[turn.absent++ % ABSENT_CYCLE.length];
  return {
    ...c,
    law: missing.includes("law") ? null : c.law,
    cap: missing.includes("cap") ? null : c.cap,
    term: missing.includes("term") ? null : c.term,
    renewal: missing.includes("term") ? { kind: "none" } : c.renewal,
    missing,
  };
}

export function buildAgreement(rng, trap, noise, sowCount) {
  const used = new Set();
  const [rp, rc] = pick(rng, ROLES);
  const parties = [party(rng, used, rp), party(rng, used, rc)];
  const effectiveDate = isoBetween(rng, "2022-01-01", "2025-12-31");
  const effectiveStyle = pick(rng, ["as_of", "as_of", "defined", "last_signature"]);
  const signatures = effectiveStyle === "last_signature"
    ? [addDays(effectiveDate, -int(rng, 1, 9)), effectiveDate]
    : [addDays(effectiveDate, -int(rng, 0, 20)), addDays(effectiveDate, -int(rng, 0, 20))];
  const termMonths = pick(rng, [12, 24, 36, 48, 60, 18]);
  const law = pick(rng, STATES);
  const base = {
    kind: pick(rng, KINDS),
    statusDate: STATUS_DATE,
    parties,
    effective: { date: effectiveDate, style: effectiveStyle },
    signatures,
    term: { months: termMonths, style: rng() < 0.35 ? "end_date" : "words", end: termEnd(effectiveDate, termMonths) },
    renewal: renewal(rng),
    cap: cap(rng),
    carveCap: pick(rng, [5000000, 7500000, 10000000]),
    law,
    venue: rng() < 0.6 ? other(rng, law, STATES) : law,
    sowCount,
    noise,
    trap,
    missing: [],
  };
  const c = trap === "absent" ? dropClauses(base) : base;
  return { ...c, amendments: TRAPS[trap](rng, c) };
}
