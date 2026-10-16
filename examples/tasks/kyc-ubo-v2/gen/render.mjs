/** Turns a structure into German register extracts: Handelsregister header, Gesellschafterliste, Satzung excerpts. */

import { pick } from "./structures.mjs";

const FIRST = ["Mara", "Felix", "Jana", "Tobias", "Lena", "Jonas", "Anika", "Henrik", "Clara", "Matthias", "Sofie", "Lukas", "Ines", "Kai", "Greta", "Moritz", "Paula", "Nils", "Theresa", "Emil", "Ruth", "Oskar", "Vera", "Bastian", "Helena", "Fabian", "Ida", "Konrad", "Anna", "Theo"];
const LAST = ["Althaus", "Brandt", "Roth", "Wendt", "Vogt", "Kessler", "Lindqvist", "Hartmann", "Seidel", "Pohl", "Engel", "Kramer", "Lorenz", "Faber", "Brenner", "Ziegler", "Haas", "Winter", "Kuhn", "Sommer", "Arendt", "Falk", "Reuter", "Lang", "Thiel", "Buchholz", "Becker", "Krüger"];
const STEM = ["Brunnfeld", "Kestrel", "Nordwall", "Eichental", "Silberau", "Falkenhorst", "Lindmoor", "Steinach", "Rabenfels", "Weidenhof", "Auental", "Grauwerk", "Tannberg", "Hellbrunn", "Ostmark", "Feldkamp"];
const TRADE = ["Logistik", "Werkstoffe", "Maschinenbau", "Handel", "Software", "Immobilien", "Energie", "Medizintechnik", "Lebensmittel", "Verpackung"];
const HOLDING = ["Holding", "Beteiligungs", "Vermögensverwaltung", "Invest"];
const COURTS = [["München", ["München", "Freising", "Rosenheim", "Augsburg"]], ["Hamburg", ["Hamburg", "Lübeck", "Norderstedt"]], ["Köln", ["Köln", "Bonn", "Düsseldorf"]], ["Frankfurt am Main", ["Frankfurt am Main", "Offenbach", "Wiesbaden", "Bad Homburg"]], ["Stuttgart", ["Stuttgart", "Esslingen", "Ludwigsburg"]], ["Berlin (Charlottenburg)", ["Berlin", "Potsdam"]]];

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
  const stem = () => pick(rng, STEM);
  return {
    person: () => fresh(() => `${pick(rng, FIRST)} ${pick(rng, LAST)}`),
    target: () => fresh(() => `${stem()} ${pick(rng, TRADE)} GmbH`),
    kg: () => fresh(() => `${stem()} ${pick(rng, TRADE)} GmbH & Co. KG`),
    generalPartner: () => fresh(() => `${stem()} Verwaltungs GmbH`),
    company: () => fresh(() => `${stem()} ${pick(rng, HOLDING)} GmbH`),
  };
}

const eur = (n) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
const pad = (n) => String(n).padStart(2, "0");

function shuffled(rng, list) {
  return list.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

/** Stable details per person and company within one item: birth date, town, register number. */
function details(rng) {
  const [court, towns] = pick(rng, COURTS);
  const seen = new Map();
  const of = (name, make) => {
    if (!seen.has(name)) seen.set(name, make());
    return seen.get(name);
  };
  const town = () => pick(rng, towns);
  // One town per person, whether they appear as shareholder, Geschäftsführer or Prokurist.
  const home = (name) => of(`town:${name}`, town);
  return {
    court,
    person: (name) => of(name, () => `${name}, geb. ${pad(1 + Math.floor(rng() * 28))}.${pad(1 + Math.floor(rng() * 12))}.${1960 + Math.floor(rng() * 35)}, ${home(name)}`),
    company: (name) => of(name, () => `${name}, Sitz ${town()}, HRB ${10000 + Math.floor(rng() * 89999)}`),
    manager: (name) => `${name}, ${home(name)}`,
    hrb: () => 10000 + Math.floor(rng() * 289999),
  };
}

const NOTE = "Die Satzungen enthalten keine weiteren Stimmrechtsregelungen. Stimmbindungs-, Pool- oder Treuhandverträge, Vetorechte oder Nießbrauchrechte liegen nicht vor.";

function holderText(d, h) {
  return h.person ? d.person(h.holder) : d.company(h.holder);
}

/** A Gesellschafterliste as a table; returns the text and the numbers of non-voting shares. */
function shareTable(rng, d, name, entity, date) {
  const rows = shuffled(rng, [...entity.holders, ...(entity.ownShares ? [{ own: true, nominal: entity.ownShares }] : [])]);
  const lines = rows.map((h, i) => `${String(i + 1).padEnd(8)} | ${(h.own ? `${name} (eigene Geschäftsanteile)` : holderText(d, h)).padEnd(52)} | ${eur(h.nominal)}`);
  const nonVoting = rows.map((h, i) => (h.voting === false ? i + 1 : null)).filter((n) => n !== null);
  return { text: [`Gesellschafterliste der ${name} (Stand: ${date})`, `lfd. Nr. | ${"Gesellschafter".padEnd(52)} | Nennbetrag`, ...lines].join("\n"), nonVoting };
}

function inlineList(rng, d, name, entity) {
  const parts = shuffled(rng, entity.holders).map((h) => `${holderText(d, h)}, ${eur(h.nominal)}`);
  return `Gesellschafterliste der ${name} (Stammkapital ${eur(entity.capital)}): ${parts.join("; ")}.`;
}

/** A list date in the past: any month of 2025, or January to September 2026. */
const date = (rng) => {
  const year = pick(rng, [2025, 2026]);
  return `${pad(1 + Math.floor(rng() * 28))}.${pad(1 + Math.floor(rng() * (year === 2026 ? 9 : 12)))}.${year}`;
};

function gmbhHeader(d, target, entity, register) {
  return [
    `Handelsregister B des Amtsgerichts ${d.court}, HRB ${d.hrb()}`,
    `Firma: ${target}`,
    `Stammkapital: ${eur(entity.capital)}`,
    `Geschäftsführer: ${register.managers.map(d.manager).join("; ")}${register.managers.length > 1 ? " (jeweils einzelvertretungsberechtigt)" : ""}`,
    ...(register.prokura.length > 0 ? [`Prokura: ${register.prokura.map(d.manager).join("; ")}`] : []),
  ];
}

function kgHeader(d, target, entity) {
  const limited = entity.holders.map((h) => `- ${d.person(h.holder)}, Hafteinlage ${eur(h.nominal)}`);
  return [
    `Handelsregister A des Amtsgerichts ${d.court}, HRA ${d.hrb()}`,
    `Firma: ${target}`,
    `Persönlich haftende Gesellschafterin: ${d.company(entity.generalPartner)}, ohne Kapitalanteil`,
    "Kommanditisten:",
    ...limited,
    "Die Hafteinlagen entsprechen den Kapitalanteilen. Die Geschäftsführung der KG obliegt allein der persönlich haftenden Gesellschafterin.",
  ];
}

export function render(rng, { target, entities }, register) {
  const d = details(rng);
  const t = entities[target];
  const subs = Object.entries(entities).filter(([name]) => name !== target);
  const blocks = [];
  if (register.kg) {
    blocks.push(kgHeader(d, target, t).join("\n"));
    const [gpName, gp] = subs.find(([name]) => name === t.generalPartner);
    blocks.push([`Handelsregister B des Amtsgerichts ${d.court}, HRB ${d.hrb()}`, `Firma: ${gpName}`, `Stammkapital: ${eur(gp.capital)}`, `Geschäftsführer: ${register.managers.map(d.manager).join("; ")}`, inlineList(rng, d, gpName, gp)].join("\n"));
  } else {
    const table = shareTable(rng, d, target, t, date(rng));
    blocks.push([...gmbhHeader(d, target, t, register), "", table.text].join("\n"));
    if (table.nonVoting.length > 0) {
      const which = table.nonVoting.length > 1 ? `Die Geschäftsanteile ${table.nonVoting.map((n) => `Nr. ${n}`).join(" und ")} gewähren` : `Der Geschäftsanteil Nr. ${table.nonVoting[0]} gewährt`;
      blocks.push(`Auszug aus der Satzung der ${target}, § 7 Abs. 3: ${which} kein Stimmrecht. Im Übrigen gewährt jeder Euro eines Geschäftsanteils eine Stimme.`);
    }
  }
  for (const [name, entity] of subs.filter(([name]) => name !== t.generalPartner)) {
    blocks.push(rng() < 0.5 ? inlineList(rng, d, name, entity) : `Stammkapital: ${eur(entity.capital)}\n${shareTable(rng, d, name, entity, date(rng)).text}`);
  }
  return [...blocks, NOTE].join("\n\n");
}
