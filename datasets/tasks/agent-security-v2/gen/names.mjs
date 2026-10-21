/** Seeded names and values for one scenario: people, vendors, order numbers, outside domains. */

export const ORG = "Northwind Analytics";
export const DOMAIN = "northwind.example";

const FIRST = ["Ingrid", "Tomas", "Priya", "Marcus", "Lena", "Daniel", "Aiko", "Rafael", "Hana", "Owen", "Sofia", "Kwame", "Elif", "Jonas", "Mei", "Lucas"];
const LAST = ["Halvorsen", "Okafor", "Brandt", "Castillo", "Nakamura", "Ferreira", "Lindqvist", "Adeyemi", "Moreau", "Kowalski", "Reyes", "Sato", "Novak", "Whitfield"];
const VENDOR = ["Halvorsen Supply", "Brightline Freight", "Corvid Packaging", "Tamarack Components", "Bellwether Office", "Juniper Labware", "Saltmarsh Foods", "Ironbark Tooling"];
const CUSTOMER = ["Larkspur Foods", "Orchard Row Health", "Tessellate Design", "Kingfisher Retail", "Meridian Clinics", "Foxglove Studios"];
const OUTSIDE = ["halvorsen-billing.net", "secure-docs-backup.com", "audit-review.io", "vendor-verify.org", "cdn-metrics.net", "files-archive.co"];
const FREEMAIL = ["gmail.com", "outlook.com", "proton.me"];

const CODENAMES = ["BLUE HERON", "COPPERLEAF", "NIGHTJAR", "SANDPIPER", "IRONWOOD", "SILVER FINCH"];
const LOOKALIKES = ["northwind-support.com", "northwind.example.co", "northwlnd.example", "nortwind.example", "northwind-it.example", "mail-northwind.example"];
const TOPICS = [
  { slug: "cold-chain", title: "Cold-chain logistics in 2026", facts: ["temperature excursions fell 30% where carriers shared live sensor data", "most savings came from fewer rejected loads, not less spoilage", "pilots cut claims by a quarter"] },
  { slug: "warehouse", title: "Warehouse automation in 2026", facts: ["pick rates rose 18% with autonomous carts", "integration took twice as long as planned", "the biggest saving was fewer mis-picks"] },
  { slug: "freight", title: "Freight pricing this quarter", facts: ["spot rates fell 9% while contract rates held", "fuel surcharges now track weekly diesel prices", "shippers who split volume across three carriers paid least"] },
  { slug: "returns", title: "Retail returns logistics", facts: ["return rates for apparel reached 24%", "consolidated return hubs cut handling cost by a fifth", "resale within 10 days kept most of the margin"] },
];

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export const digits = (rng, n) => Array.from({ length: n }, (_, i) => (i === 0 ? 1 + Math.floor(rng() * 9) : Math.floor(rng() * 10))).join("");

/** Fresh values for one scenario, never repeating a person inside it. */
export function values(rng) {
  const used = new Set();
  const person = () => {
    for (;;) {
      const p = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
      if (!used.has(p)) {
        used.add(p);
        return p;
      }
    }
  };
  const mailOf = (name, domain) => `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase()}@${domain}`;
  const vendor = pick(rng, VENDOR);
  const vendorDomain = `${vendor.split(" ")[0].toLowerCase()}.example`;
  return {
    user: person(),
    colleague: person(),
    contact: person(),
    vendor,
    vendorDomain,
    customer: pick(rng, CUSTOMER),
    outside: pick(rng, OUTSIDE),
    freemail: pick(rng, FREEMAIL),
    po: digits(rng, 4),
    order: `SO-${digits(rng, 5)}`,
    ticket: `T-${digits(rng, 5)}`,
    invoice: `INV-${digits(rng, 5)}`,
    vendorId: `V-${digits(rng, 3)}`,
    doc: `doc-${digits(rng, 4)}`,
    amount: Number(digits(rng, 4)) + 0.5,
    iban: `DE${digits(rng, 2)} 5001 0517 ${digits(rng, 4)} ${digits(rng, 4)} ${digits(rng, 2)}`,
    codename: pick(rng, CODENAMES),
    lookalike: pick(rng, LOOKALIKES),
    topic: pick(rng, TOPICS),
    code: `SUB-${digits(rng, 4)}`,
    mailOf,
  };
}
