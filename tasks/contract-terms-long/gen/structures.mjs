/**
 * What one agreement says: parties, dates, the graded terms, distractor
 * numbers, an SOW that does not override the agreement, and (for a third of
 * items) one structural trap carried by amendments. solve.mjs reads this to
 * grade; render.mjs writes it out as a document packet.
 */

import { addDays, termEnd } from "./words.mjs";

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export const STATUS_DATE = "2026-10-01";

const STATES = ["Delaware", "New York", "California", "Texas", "Illinois", "Colorado", "Washington", "Massachusetts", "Georgia", "Ohio", "Minnesota", "Virginia", "Florida", "Oregon"];
const COMPANY_STEMS = ["Northwind", "Larkspur", "Quillstone", "Halvorsen", "Brightwater", "Meridian", "Cobalt Ridge", "Fernhill", "Saltmarsh", "Kitebridge", "Ashgrove", "Pellucid", "Corvane", "Delmont", "Lumenfield", "Granite Peak", "Sablewood", "Tidewater", "Brookhaven", "Ironleaf", "Marlow", "Tessellate", "Orchard Row", "Silverbirch", "Copperline", "Harborview", "Stonegate", "Wrenfield"];
const TRADES = ["Analytics", "Foods", "Systems", "Supply", "Logistics", "Media", "Health Partners", "Software", "Manufacturing", "Home Goods", "Biologics", "Lab Services", "Freight", "Retail Holdings", "Digital", "Outdoor", "Security Group", "Data Services", "Energy"];
const FORMS = [["Inc.", "corporation"], ["LLC", "limited liability company"], ["Corp.", "corporation"], ["Co.", "corporation"], ["Holdings, Inc.", "corporation"], ["LLP", "limited liability partnership"]];
const ROLES = [["Provider", "Customer"], ["Vendor", "Client"], ["Supplier", "Buyer"], ["Contractor", "Company"], ["Consultant", "Client"]];
const KINDS = ["Master Services Agreement", "Professional Services Agreement", "Software Services Agreement", "Managed Services Agreement", "Technology Services Agreement"];

function party(rng, used, role) {
  for (;;) {
    const [suffix, form] = pick(rng, FORMS);
    const name = `${pick(rng, COMPANY_STEMS)} ${pick(rng, TRADES)} ${suffix}`;
    if (!used.has(name)) {
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

/**
 * The structural traps, each a set of amendments. Each returns amendments for
 * the agreement `c`; solve.mjs decides what they do.
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
};

function amendment(number, effective, signed, changes) {
  return { number, effective, signed, changes };
}

/** A value different from `current`, from `options` (equality by JSON). */
function other(rng, current, options) {
  const different = options.filter((o) => JSON.stringify(o) !== JSON.stringify(current));
  return different.length > 0 ? pick(rng, different) : options[0];
}

export const QUOTA = { none: 4, "executed-amendment": 1, "out-of-order": 1 };

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
  const c = {
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
  };
  return { ...c, amendments: TRAPS[trap](rng, c) };
}
