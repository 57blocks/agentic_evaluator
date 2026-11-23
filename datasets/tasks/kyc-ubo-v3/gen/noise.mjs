/**
 * Roughens a v2 register extract the way real extracts differ: dates and
 * amounts written other ways, a table without its alignment, entries no rule
 * reads, a missing detail, scanned labels. None of it changes who holds what,
 * so v2's solve.mjs answer stays the answer; every type applied is returned.
 */

import { pick, int, sample } from "../../../gen-kit/seeding.mjs";

/** In the order they are applied: details are dropped and lines added while dates and amounts are still in v2's format. */
const NOISE_TYPES = ["missing-detail", "distractor-entries", "table-layout", "ocr", "date-formats", "amount-formats"];
/** How many noise types an item gets: 0 (clean) to 3. */
const NOISE_COUNT_WEIGHTS = [0.15, 0.35, 0.35, 0.15];

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DE_DATE = /\b(\d{2})\.(\d{2})\.(\d{4})\b/g;
const DATE_FORMATS = {
  iso: (d, m, y) => `${y}-${m}-${d}`,
  "d. monat yyyy": (d, m, y) => `${Number(d)}. ${MONATE[Number(m) - 1]} ${y}`,
  "d.m.yyyy": (d, m, y) => `${Number(d)}.${Number(m)}.${y}`,
};

/** German amounts only: "12.250,00 EUR" never turns into an English "12,250.00" that could read as 12.25. */
const DE_AMOUNT = /\b(\d{1,3}(?:\.\d{3})*),(\d{2}) EUR\b/g;
const AMOUNT_FORMATS = {
  "eur-prefix": (whole, cents) => `EUR ${whole},${cents}`,
  euro: (whole, cents) => `${whole},${cents} €`,
  "dash-cents": (whole, cents) => (cents === "00" ? `${whole},– EUR` : `${whole},${cents} EUR`),
};

/** Register lines no rule reads: no shares, no votes, no current office. */
const DISTRACTORS = [
  (rng) => `Gegenstand des Unternehmens: ${pick(rng, ["der Handel mit Waren aller Art", "die Erbringung von Beratungsleistungen", "die Verwaltung eigenen Vermögens", "die Entwicklung und der Vertrieb von Software"])}.`,
  (rng) => `Sitzverlegung: Der Sitz wurde von ${pick(rng, ["Kassel", "Ulm", "Bremen", "Leipzig"])} verlegt. Eingetragen am ${String(int(rng, 1, 28)).padStart(2, "0")}.${String(int(rng, 1, 12)).padStart(2, "0")}.${int(rng, 2015, 2022)}.`,
  (rng) => `Letzte Änderung der Satzung: Beschluss der Gesellschafterversammlung vom ${String(int(rng, 1, 28)).padStart(2, "0")}.${String(int(rng, 1, 12)).padStart(2, "0")}.${int(rng, 2018, 2024)} (Änderung des Geschäftsjahres).`,
  (rng) => `Bekanntmachungen erfolgen im ${pick(rng, ["Bundesanzeiger", "elektronischen Bundesanzeiger"])}.`,
  // The legal form must match the Firma line it sits under: a KG's rules turn on it being a KG.
  (rng, firma) =>
    `Rechtsform: ${firma.endsWith("& Co. KG") ? "Kommanditgesellschaft. Gesellschaftsvertrag" : "Gesellschaft mit beschränkter Haftung. Gesellschaftsvertrag"} vom ${String(int(rng, 1, 28)).padStart(2, "0")}.${String(int(rng, 1, 12)).padStart(2, "0")}.${int(rng, 1998, 2014)}.`,
];

/** Labels a scan may garble; names, numbers and the Satzung's wording are never touched. */
const LABELS = ["Handelsregister", "Amtsgerichts", "Stammkapital", "Geschäftsführer", "Gesellschafterliste", "Gesellschafter", "Nennbetrag", "Kommanditisten", "Prokura"];
const OCR_SWAPS = [["l", "1"], ["i", "l"], ["e", "c"], ["rn", "m"], ["ä", "a"], ["h", "b"]];
function ocrLabel(rng, label) {
  const usable = OCR_SWAPS.filter(([from]) => label.includes(from));
  if (usable.length === 0) return label;
  const [from, to] = pick(rng, usable);
  return label.replace(from, to);
}

function noiseCount(rng) {
  let r = rng();
  for (let k = 0; k < NOISE_COUNT_WEIGHTS.length; k++) {
    r -= NOISE_COUNT_WEIGHTS[k];
    if (r < 0) return k;
  }
  return NOISE_COUNT_WEIGHTS.length - 1;
}

/** A Gesellschafterliste row "1        | Name ...  | 6.000,00 EUR" without its padding, joined another way. */
function relayout(text, separator) {
  return text
    .split("\n")
    .map((line) => (/^(lfd\. Nr\.|\d+\s+)\s*\|/.test(line) ? line.split("|").map((cell) => cell.trim()).join(separator) : line))
    .join("\n");
}

/** @returns {{ text: string, noise: string[] }} */
export function roughen(rng, text) {
  const types = sample(rng, NOISE_TYPES, noiseCount(rng));
  const applied = [];
  let out = text;
  for (const type of types) {
    if (type === "date-formats") {
      const format = pick(rng, Object.keys(DATE_FORMATS));
      out = out.replace(DE_DATE, (_, d, m, y) => DATE_FORMATS[format](d, m, y));
      applied.push(`date-formats:${format}`);
    } else if (type === "amount-formats") {
      const format = pick(rng, Object.keys(AMOUNT_FORMATS));
      out = out.replace(DE_AMOUNT, (_, whole, cents) => AMOUNT_FORMATS[format](whole, cents));
      applied.push(`amount-formats:${format}`);
    } else if (type === "table-layout") {
      const separator = pick(rng, [["; ", "semicolons"], ["\t", "tabs"], ["  ", "spaces"]]);
      const before = out;
      out = relayout(out, separator[0]);
      if (out !== before) applied.push(`table-layout:${separator[1]}`);
    } else if (type === "distractor-entries") {
      const firma = out.match(/^Firma: (.*)$/m)[1];
      const lines = sample(rng, DISTRACTORS, int(rng, 1, 2)).map((make) => make(rng, firma));
      // After the first register block's "Firma:" line, where a register prints such entries.
      out = out.replace(/^(Firma: .*)$/m, (line) => [line, ...lines].join("\n"));
      applied.push("distractor-entries");
    } else if (type === "missing-detail") {
      const which = pick(rng, ["birth-dates", "list-date", "register-numbers"]);
      const before = out;
      if (which === "birth-dates") out = out.replace(/, geb\. \d{2}\.\d{2}\.\d{4}/g, "");
      if (which === "list-date") out = out.replace(/ \(Stand: \d{2}\.\d{2}\.\d{4}\)/g, "");
      if (which === "register-numbers") out = out.replace(/, Sitz ([^,]+), HRB \d+/g, ", Sitz $1");
      if (out !== before) applied.push(`missing-detail:${which}`);
    } else if (type === "ocr") {
      const garbled = sample(rng, LABELS.filter((l) => out.includes(l)), 2);
      // Whole words only, so "Gesellschafter" never garbles inside "Gesellschafterliste".
      for (const label of garbled) out = out.replace(new RegExp(`(?<![\\p{L}])${label}(?![\\p{L}])`, "gu"), ocrLabel(rng, label));
      if (garbled.length > 0) applied.push("ocr");
    }
  }
  return { text: out, noise: applied };
}
