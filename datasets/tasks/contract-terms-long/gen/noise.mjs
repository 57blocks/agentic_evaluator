/**
 * Makes a packet read like a scanned, OCR'd document.
 *
 * Two kinds of damage:
 *   - character damage (l→1, O→0, rn→m, a dropped letter…) on words OUTSIDE
 *     the protected strings, so a graded value is never altered;
 *   - layout damage anywhere: lines wrapped and hyphenated at a fixed width,
 *     and page headers/footers dropped in mid-sentence, which can split a
 *     graded value across a line or a page break, as real scans do.
 *
 * `readable` undoes only the layout damage; generate.mjs asserts every
 * protected string is in it, so each answer stays derivable from the text.
 */

import { pick } from "./structures.mjs";

const LEVELS = {
  clean: null,
  light: { charRate: 0.015, width: 78, pageLines: 60, hyphenate: 0.25, artifacts: 0 },
  heavy: { charRate: 0.05, width: 66, pageLines: 46, hyphenate: 0.5, artifacts: 0.08 },
};

const SUBSTITUTIONS = [
  [/l/, "1"], [/O/, "0"], [/o/, "0"], [/rn/, "m"], [/m/, "rn"], [/e/, "c"], [/i/, "l"], [/S/, "5"], [/,/, "."], [/h/, "b"],
];

function damageWord(rng, word) {
  const options = SUBSTITUTIONS.filter(([re]) => re.test(word));
  if (options.length > 0 && rng() < 0.75) {
    const [re, to] = pick(rng, options);
    return word.replace(re, to);
  }
  if (word.length > 4) {
    const i = 1 + Math.floor(rng() * (word.length - 2));
    return word.slice(0, i) + word.slice(i + 1);
  }
  return word;
}

/** Ranges [start, end) of every occurrence of every protected string. */
function protectedRanges(text, strings) {
  const ranges = [];
  for (const s of strings) {
    for (let at = text.indexOf(s); at !== -1; at = text.indexOf(s, at + 1)) ranges.push([at, at + s.length]);
  }
  return ranges;
}

function damageCharacters(rng, text, strings, rate) {
  const ranges = protectedRanges(text, strings);
  const isProtected = (start, end) => ranges.some(([a, b]) => start < b && end > a);
  return text.replace(/\S+/g, (word, start) => (rng() < rate && !isProtected(start, start + word.length) ? damageWord(rng, word) : word));
}

/** Wrap one line at `width`, sometimes hyphenating the word that would overflow. */
function wrap(rng, line, width, hyphenate) {
  const out = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current.length + 1 + word.length <= width || current === "") {
      current = current === "" ? word : `${current} ${word}`;
      continue;
    }
    const room = width - current.length - 2;
    if (rng() < hyphenate && room >= 3 && word.length - room >= 3 && /^[A-Za-z]+$/.test(word.slice(0, room))) {
      out.push(`${current} ${word.slice(0, room)}-`);
      current = word.slice(room);
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

const HEADER = /^(?:— .+ — CONFIDENTIAL — Page \d+ of \d+|[~.:'`, ]{3,})$/;

function paginate(rng, lines, title, cfg) {
  const pages = Math.ceil(lines.length / cfg.pageLines);
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0 && i % cfg.pageLines === 0) out.push(`— ${title} — CONFIDENTIAL — Page ${i / cfg.pageLines} of ${pages}`);
    if (rng() < cfg.artifacts) out.push(pick(rng, ["~ ~ .", ". : '", "`` ..", ",. ~~"]));
    out.push(line);
  });
  return out;
}

export function addNoise(rng, text, strings, level, title) {
  const cfg = LEVELS[level];
  if (!cfg) return text;
  const damaged = damageCharacters(rng, text, strings, cfg.charRate);
  const lines = damaged.split("\n").flatMap((line) => (line.includes(" | ") ? [line] : wrap(rng, line, cfg.width, cfg.hyphenate)));
  return paginate(rng, lines, title, cfg).join("\n");
}

/** The text with layout damage undone: headers and artifacts dropped, hyphenated breaks joined, lines run together. */
export function readable(text) {
  return text
    .split("\n")
    .filter((l) => !HEADER.test(l.trim()))
    .join("\n")
    .replace(/([A-Za-z])-\n(?=[A-Za-z])/g, "$1")
    .replace(/\s+/g, " ");
}
