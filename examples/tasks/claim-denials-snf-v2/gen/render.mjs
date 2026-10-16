/**
 * Writes a case as a biller sees it: the claim's UB-04 fields, the remittance
 * as raw 835 segments (codes only, no code descriptions) and the facility's
 * records. No payer manual and no rule text: knowing the rules is the test.
 */

import { pick } from "./structures.mjs";
import { daysBetween } from "./rules.mjs";

const FACILITIES = ["Brookside Skilled Nursing", "Maple Court Rehabilitation", "Willow Bend Care Center", "Harbor Pointe Nursing and Rehab", "Cedar Ridge Health Center", "Lakeview Transitional Care"];
const MACS = ["Sample MAC Jurisdiction A", "Sample MAC Jurisdiction B"];
const FIRST = ["Ruth", "Harold", "Walter", "Elsie", "Joan", "Daniel", "Marjorie", "Eugene", "Dolores", "Frank", "Irene", "Leonard", "Beatrice", "Arthur"];
const LAST = ["Delaney", "Benning", "Ng", "Carmody", "Whitaker", "Ostrowski", "Pruitt", "Halloran", "Vasquez", "Lindgren", "Okafor", "Brennan", "Castillo", "Moreau"];

const d8 = (iso) => iso.replaceAll("-", "");
const money = (n) => n.toFixed(2);

function remittance(rng, c, billed, icn) {
  const r = c.remit;
  const paid = r.partial ? Math.round(billed * (daysBetween(c.claim.from, r.partial.paidThrough) + 1) / (daysBetween(c.claim.from, c.claim.through) + 1) * 0.62 * 100) / 100 : 0;
  const status = paid > 0 ? 1 : 4;
  const lines = [
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
  return `REMITTANCE (835 excerpt, production date ${r.date})\n${lines.join("\n")}${notes.length ? `\n${notes.join("\n")}` : ""}`;
}

export function render(rng, c) {
  const billed = (daysBetween(c.claim.from, c.claim.through) + 1) * pick(rng, [610, 655, 690, 720, 745]);
  const icn = `2${String(Math.floor(rng() * 1e12)).padStart(12, "0")}`;
  const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
  const q = c.claim.qualifying;
  const claim = [
    `CLAIM ${c.claimNo} · Medicare Part A · bill type 0211 (SNF inpatient)`,
    `Facility: ${pick(rng, FACILITIES)} (synthetic) · Contractor: ${pick(rng, MACS)}`,
    `Beneficiary: ${name} · MBI ${pick(rng, ["1EG4", "7TQ2", "3KM9"])}-${pick(rng, ["TE5", "HA2", "RW8"])}-MK${Math.floor(rng() * 90 + 10)} (synthetic)`,
    `Statement covers period: From ${c.claim.from} Through ${c.claim.through} · Admission date ${c.claim.from}`,
    ...(q ? [`Occurrence span 70 (qualifying stay): ${q.admitOrder} to ${q.discharge}`] : []),
    `Total charges: $${money(billed)}`,
    `Received by contractor: ${c.claim.filed}`,
  ].join("\n");
  return [claim, remittance(rng, c, billed, icn), `FACILITY RECORDS\n${c.history.join("\n")}`].join("\n\n");
}
