/** Turns a structure into the text a candidate reads: a register-style list or prose. */

import { pick } from "./structures.mjs";

const FIRST = ["Mara", "Felix", "Jana", "Tobias", "Lena", "Jonas", "Anika", "Henrik", "Clara", "Matthias", "Sofie", "Lukas", "Ines", "Kai", "Greta", "Moritz", "Paula", "Nils", "Theresa", "Emil", "Ruth", "Oskar", "Vera", "Bastian", "Helena", "Fabian", "Ida", "Konrad"];
const LAST = ["Althaus", "Brandt", "Roth", "Wendt", "Vogt", "Kessler", "Lindqvist", "Hartmann", "Seidel", "Pohl", "Engel", "Kramer", "Lorenz", "Faber", "Brenner", "Ziegler", "Haas", "Winter", "Kuhn", "Sommer", "Arendt", "Falk", "Reuter", "Lang", "Thiel", "Buchholz"];
const STEM = ["Brunnfeld", "Kestrel", "Nordwall", "Eichental", "Silberau", "Falkenhorst", "Lindmoor", "Steinach", "Rabenfels", "Weidenhof", "Auental", "Grauwerk", "Tannberg", "Hellbrunn", "Ostmark", "Feldkamp"];
const TRADE = ["Logistik", "Werkstoffe", "Maschinenbau", "Handel", "Software", "Immobilien", "Energie", "Medizintechnik", "Lebensmittel", "Verpackung"];
const HOLDING = ["Holding", "Beteiligungs", "Vermögensverwaltung", "Invest"];

/** Fresh, unique names for one item. */
export function nameSource(rng) {
  const used = new Set();
  const fresh = (make) => {
    for (;;) {
      const name = make();
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
  let companies = 0;
  return {
    person: () => fresh(() => `${pick(rng, FIRST)} ${pick(rng, LAST)}`),
    // The first company asked for is the target; the rest are holding companies.
    company: () => fresh(() => (companies++ === 0 ? `${pick(rng, STEM)} ${pick(rng, TRADE)} GmbH` : `${pick(rng, STEM)} ${pick(rng, HOLDING)} GmbH`)),
  };
}

const NOTE = "Voting rights follow capital in every company listed. No voting agreements, trusts, nominee arrangements or other control arrangements are on file.";

function shuffled(rng, list) {
  return list.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

function asList(rng, { target, directors, holdings }) {
  const blocks = Object.entries(holdings).map(([company, holders]) => [`Shareholders of ${company}:`, ...shuffled(rng, holders).map((s) => `- ${s.holder}${s.person ? "" : " (company)"}: ${s.percent}%`)].join("\n"));
  return [`Company under review: ${target}`, `Managing director${directors.length > 1 ? "s" : ""}: ${directors.join(", ")}`, "", ...blocks.flatMap((b) => [b, ""]), NOTE].join("\n");
}

function asProse(rng, { target, directors, holdings }) {
  const sentences = Object.entries(holdings).map(([company, holders]) => {
    const parts = shuffled(rng, holders).map((s) => `${s.person ? "" : "the company "}${s.holder} holds ${s.percent}%`);
    return `In ${company}, ${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts.at(-1)}.`;
  });
  const md = directors.length > 1 ? `Its managing directors are ${directors.join(" and ")}.` : `Its managing director is ${directors[0]}.`;
  return [`Register extract for ${target}. ${md}`, "", ...sentences, "", NOTE].join("\n");
}

export function render(rng, structure) {
  return rng() < 0.5 ? asList(rng, structure) : asProse(rng, structure);
}
