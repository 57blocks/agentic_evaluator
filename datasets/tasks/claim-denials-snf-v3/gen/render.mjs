/**
 * Writes a v2 case as a biller sees it (UB-04 fields, raw 835 segments, the
 * facility's records), then roughens it with noise that never touches a fact
 * the answer depends on. Facts come from the item's facts stream; noise comes
 * from its own stream, and every noise type applied is returned as a tag.
 *
 * v2's render.mjs stays as it is (claim-denials-snf-v2 is published); this is
 * its layout, plus noise, plus the facts each step's key needs.
 */

import { daysBetween, addDays } from "../../claim-denials-snf-v2/gen/rules.mjs";
import { pick, int, sample } from "../../../gen-kit/seeding.mjs";

const FACILITIES = ["Brookside Skilled Nursing", "Maple Court Rehabilitation", "Willow Bend Care Center", "Harbor Pointe Nursing and Rehab", "Cedar Ridge Health Center", "Lakeview Transitional Care", "Sycamore Glen Post-Acute", "Riverside Commons Nursing", "Fairhaven Rehabilitation Center", "Pinecrest Manor"];
const MACS = ["Sample MAC Jurisdiction A", "Sample MAC Jurisdiction B", "Sample MAC Jurisdiction C"];
const FIRST = ["Ruth", "Harold", "Walter", "Elsie", "Joan", "Daniel", "Marjorie", "Eugene", "Dolores", "Frank", "Irene", "Leonard", "Beatrice", "Arthur", "Lorraine", "Clarence", "Mildred", "Raymond", "Gloria", "Vernon", "Yolanda", "Takeshi", "Rosario", "Hyun-woo"];
const LAST = ["Delaney", "Benning", "Ng", "Carmody", "Whitaker", "Ostrowski", "Pruitt", "Halloran", "Vasquez", "Lindgren", "Okafor", "Brennan", "Castillo", "Moreau", "Abernathy", "Szymanski", "Tran", "Gallagher", "Iwasaki", "Feliciano", "Lundqvist", "Mbeki", "Dorsey", "Kowalczyk"];

/** Facility notes no rule reads: no stay, no hospital, no submission, no coverage. */
const DISTRACTORS = [
  "Care plan meeting held with the resident's daughter.",
  "Pharmacy medication reconciliation completed.",
  "Speech-language pathology screen: no deficits noted.",
  "Resident moved to room {room}.",
  "Dietary consult: mechanical soft diet ordered.",
  "Fall-risk assessment updated; bed alarm in place.",
  "Influenza vaccine offered; resident declined.",
  "MDS assessment completed and transmitted.",
  "Therapy minutes reconciled for the week.",
  "Wound care nurse review: skin intact.",
  "Resident council meeting attended.",
  "Hearing aid batteries replaced at family's request.",
];

const NOISE_TYPES = ["date-formats", "835-one-line", "distractor-records", "missing-field", "ocr"];
/** How many noise types an item gets: 0 (clean) to 3. */
const NOISE_COUNT_WEIGHTS = [0.15, 0.35, 0.35, 0.15];

const d8 = (iso) => iso.replaceAll("-", "");
const money = (n) => n.toFixed(2);
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** US formats a biller meets in practice; none is ambiguous with the year written out or the month named. */
const DATE_FORMATS = {
  "mm/dd/yyyy": (y, m, d) => `${m}/${d}/${y}`,
  "m/d/yyyy": (y, m, d) => `${Number(m)}/${Number(d)}/${y}`,
  "mon d, yyyy": (y, m, d) => `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`,
  "dd-mon-yyyy": (y, m, d) => `${d}-${MONTHS[Number(m) - 1].toUpperCase()}-${y}`,
};
const reformatDates = (text, format) => text.replace(ISO_DATE, (_, y, m, d) => DATE_FORMATS[format](y, m, d));
/** An ISO date as the records of an item with this noise write their dates. */
export function recordsDate(iso, noise) {
  const tag = noise.find((n) => n.startsWith("date-formats:"));
  return tag ? reformatDates(iso, tag.split("+")[1]) : iso;
}

function noiseCount(rng) {
  let r = rng();
  for (let k = 0; k < NOISE_COUNT_WEIGHTS.length; k++) {
    r -= NOISE_COUNT_WEIGHTS[k];
    if (r < 0) return k;
  }
  return NOISE_COUNT_WEIGHTS.length - 1;
}

/**
 * OCR-style letter swaps in a scanned label: words of 5+ letters only, never
 * a date, a code, or a word of a name (`keep`), so every fact still reads as
 * the key has it.
 */
const OCR_SWAPS = [["l", "1"], ["i", "l"], ["O", "0"], ["rn", "m"], ["m", "rn"], ["e", "c"], ["S", "5"]];
function ocr(rng, line, keep) {
  return line.replace(/\b[A-Za-z]{5,}\b/g, (word) => {
    if (keep.has(word) || rng() > 0.25) return word;
    const usable = OCR_SWAPS.filter(([from]) => word.includes(from));
    if (usable.length === 0) return word;
    const [from, to] = pick(rng, usable);
    return word.replace(from, to);
  });
}

/** The 835 excerpt's segments and the notes under them. */
function remittance(c, billed, icn) {
  const r = c.remit;
  const paid = r.partial ? Math.round(billed * (daysBetween(c.claim.from, r.partial.paidThrough) + 1) / (daysBetween(c.claim.from, c.claim.through) + 1) * 0.62 * 100) / 100 : 0;
  const status = paid > 0 ? 1 : 4;
  const segments = [
    `DTM*405*${d8(r.date)}~`,
    `CLP*${c.claimNo}*${status}*${money(billed)}*${money(paid)}**MA*${icn}*21*1~`,
    `CAS*${r.group}*${r.carc}*${money(billed - paid)}~`,
    ...(r.remark ? [`MIA*0***0*${r.remark}~`] : []),
    `DTM*232*${d8(c.claim.from)}~`,
    `DTM*233*${d8(c.claim.through)}~`,
  ];
  const notes = [
    ...(r.partial ? [`Covered days paid through ${r.partial.paidThrough}; days after that adjusted as shown.`] : []),
    ...(r.contractorReason ? [`Contractor reason narrative: ${r.contractorReason}`] : []),
  ];
  return { segments, notes, paid, status };
}

/**
 * The identifying facts of a claim file: what a draft may state about the
 * case besides the dates and codes. A name, number or amount outside these
 * (and outside the parsed key) is invented.
 */
function identity(rng, c) {
  const days = daysBetween(c.claim.from, c.claim.through) + 1;
  return {
    claim_no: c.claimNo,
    beneficiary: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
    mbi: `${int(rng, 1, 9)}${pick(rng, ["EG", "TQ", "KM", "HW", "RC"])}${int(rng, 1, 9)}-${pick(rng, ["TE", "HA", "RW", "XN"])}${int(rng, 1, 9)}-${pick(rng, ["MK", "PJ", "CD"])}${int(rng, 10, 99)}`,
    facility: pick(rng, FACILITIES),
    contractor: pick(rng, MACS),
    icn: `2${String(Math.floor(rng() * 1e12)).padStart(12, "0")}`,
    billed: days * pick(rng, [610, 655, 690, 720, 745, 780, 815]),
  };
}

/**
 * @returns {{ text: string, facts: object, parsed: object, records: { relevant: string[], distractors: string[] }, noise: string[] }}
 */
export function render(factsRng, noiseRng, c) {
  const id = identity(factsRng, c);
  const remit = remittance(c, id.billed, id.icn);
  const q = c.claim.qualifying;

  const noise = sample(noiseRng, NOISE_TYPES, noiseCount(noiseRng));
  const has = (type) => noise.includes(type);
  const dropped = has("missing-field") ? pick(noiseRng, ["total-charges", "contractor", "mbi"]) : null;
  const headerFormat = has("date-formats") ? pick(noiseRng, Object.keys(DATE_FORMATS)) : null;
  // A second, different format for the records: the header and the records disagree, as two systems do.
  const recordsFormat = headerFormat ? pick(noiseRng, Object.keys(DATE_FORMATS).filter((f) => f !== headerFormat)) : null;

  const distractors = has("distractor-records")
    ? sample(noiseRng, DISTRACTORS, int(noiseRng, 1, 3)).map((line) => {
        const on = addDays(c.claim.from, int(noiseRng, 0, daysBetween(c.claim.from, c.claim.through)));
        return `${on}  ${line.replace("{room}", `${int(noiseRng, 100, 299)}${pick(noiseRng, ["A", "B"])}`)}`;
      })
    : [];
  // Each distractor goes before the first dated record that comes after it, so the records stay in date order.
  const records = distractors.reduce((lines, line) => {
    const at = lines.findIndex((l) => /^\d{4}-\d{2}-\d{2}/.test(l) && l.slice(0, 10) > line.slice(0, 10));
    return at === -1 ? [...lines, line] : [...lines.slice(0, at), line, ...lines.slice(at)];
  }, c.history);

  let header = [
    `CLAIM ${c.claimNo} · Medicare Part A · bill type 0211 (SNF inpatient)`,
    `Facility: ${id.facility} (synthetic)${dropped === "contractor" ? "" : ` · Contractor: ${id.contractor}`}`,
    `Beneficiary: ${id.beneficiary}${dropped === "mbi" ? "" : ` · MBI ${id.mbi} (synthetic)`}`,
    `Statement covers period: From ${c.claim.from} Through ${c.claim.through} · Admission date ${c.claim.from}`,
    ...(q ? [`Occurrence span 70 (qualifying stay): ${q.admitOrder} to ${q.discharge}`] : []),
    ...(dropped === "total-charges" ? [] : [`Total charges: $${money(id.billed)}`]),
    `Received by contractor: ${c.claim.filed}`,
  ];
  if (has("ocr")) {
    const names = new Set([id.facility, id.beneficiary, id.contractor].flatMap((n) => n.split(/[^A-Za-z]+/)));
    header = header.map((line) => ocr(noiseRng, line, names));
  }
  let headerText = header.join("\n");
  let remitTitle = `REMITTANCE (835 excerpt, production date ${c.remit.date})`;
  let recordsText = records.join("\n");
  let notesText = remit.notes.join("\n");
  if (headerFormat) {
    headerText = reformatDates(headerText, headerFormat);
    remitTitle = reformatDates(remitTitle, headerFormat);
    notesText = reformatDates(notesText, headerFormat);
    recordsText = reformatDates(recordsText, recordsFormat);
  }
  const segments = has("835-one-line") ? remit.segments.join("") : remit.segments.join("\n");
  const remitText = [remitTitle, segments, ...(notesText ? [notesText] : [])].join("\n");

  return {
    text: [headerText, remitText, `FACILITY RECORDS\n${recordsText}`].join("\n\n"),
    // A field the noise dropped is not a fact of this file (the charge stays: the CLP segment carries it).
    facts: { ...id, billed: money(id.billed), paid: money(remit.paid), ...(dropped === "contractor" ? { contractor: null } : {}), ...(dropped === "mbi" ? { mbi: null } : {}) },
    parsed: {
      claim_status: remit.status,
      group_code: c.remit.group,
      carc: c.remit.carc,
      remark: c.remit.remark ?? null,
      statement_from: c.claim.from,
      statement_through: c.claim.through,
      received_date: c.claim.filed,
      remittance_date: c.remit.date,
      paid_through: c.remit.partial?.paidThrough ?? null,
      qualifying_stay: q ? { admit_order: q.admitOrder, discharge: q.discharge } : null,
    },
    records: { relevant: c.history, distractors },
    noise: noise.map((type) => (type === "missing-field" ? `missing-field:${dropped}` : type === "date-formats" ? `date-formats:${headerFormat}+${recordsFormat}` : type)),
  };
}
