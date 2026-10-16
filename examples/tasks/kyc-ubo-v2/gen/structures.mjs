/**
 * One builder per kind of case. Builders work in percent of the target's
 * capital; buildStructure turns that into euro amounts. solve.mjs decides the
 * answer, so a builder only has to set the trap, not grade it.
 */

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Split `total` among small holders, each at most `cap`. */
function smallStakes(rng, total, cap = 20) {
  const parts = [];
  let left = total;
  while (left > 0) {
    const options = [5, 10, 15, cap].filter((n) => n <= Math.min(left, cap));
    const part = options.length === 0 ? left : pick(rng, options);
    parts.push(part);
    left -= part;
  }
  return parts;
}

const P = (holder, pct, voting = true) => ({ holder, pct, person: true, voting });
const E = (holder, pct) => ({ holder, pct, person: false });
const persons = (names, pcts) => pcts.map((pct) => P(names.person(), pct));
/** An intermediate entity owned by the given percentages; `first` takes the first stake. */
const ownedBy = (names, pcts, first) => pcts.map((pct, i) => P(i === 0 && first ? first : names.person(), pct));

const ARCHETYPES = {
  normal: {
    tags: ["normal"],
    build: (rng, names) => ({ holders: persons(names, pick(rng, [[60, 40], [55, 45], [50, 30, 20], [45, 35, 20], [70, 30], [40, 40, 20], [34, 33, 33]])) }),
  },
  "nominal-boundary": {
    tags: ["hard", "nominal-boundary"],
    // In euros, not percent: one holder at exactly a quarter, one a single euro above it, in two shares.
    build: (rng, names, capital) => {
      const quarter = capital / 4;
      const [a, b, c] = [names.person(), names.person(), names.person()];
      return {
        euros: true,
        holders: [P(a, quarter), P(b, quarter - 250), P(c, capital - 2 * quarter - 1), P(b, 251)],
      };
    },
  },
  aggregation: {
    tags: ["hard", "aggregation", "two-layers"],
    build: (rng, names) => {
      const [direct, viaHolding] = pick(rng, [[15, 12], [10, 20], [20, 10], [15, 15], [12, 13]]);
      const owner = names.person();
      const holding = names.company();
      const big = pick(rng, [30, 35, 40]);
      return {
        holders: [P(owner, direct), E(holding, viaHolding), ...persons(names, [big, ...smallStakes(rng, 100 - direct - viaHolding - big)])],
        entities: { [holding]: ownedBy(names, pick(rng, [[60, 40], [55, 45], [100], [75, 25]]), owner) },
      };
    },
  },
  "two-vehicles": {
    tags: ["hard", "two-vehicles", "no-control-50-50", "two-layers"],
    build: (rng, names) => {
      const owner = names.person();
      const [h1, h2, w] = [names.company(), names.company(), names.company()];
      const [y1, y2] = pick(rng, [[15, 15], [12, 15], [14, 14]]);
      const wPct = pick(rng, [30, 40]);
      return {
        holders: [E(h1, y1), E(h2, y2), E(w, wPct), ...persons(names, smallStakes(rng, 100 - y1 - y2 - wPct))],
        entities: {
          [h1]: ownedBy(names, pick(rng, [[70, 30], [55, 45], [100]]), owner),
          [h2]: ownedBy(names, pick(rng, [[60, 40], [80, 20]]), owner),
          [w]: ownedBy(names, [50, 50]),
        },
      };
    },
  },
  "voting-rights": {
    tags: ["hard", "voting-rights"],
    build: (rng, names) => {
      const shape = pick(rng, [
        [[24, true], [24, true], [26, false], [26, false]],
        [[20, true], [10, true], [10, true], [60, false]],
        [[15, true], [15, true], [15, true], [55, false]],
      ]);
      return { holders: shape.map(([pct, voting]) => P(names.person(), pct, voting)) };
    },
  },
  "own-shares": {
    tags: ["hard", "own-shares"],
    build: (rng, names) => {
      const [own, rest] = pick(rng, [[50, [25, 25]], [40, [20, 20, 20]], [40, [24, 24, 12]]]);
      return { ownPct: own, holders: persons(names, rest) };
    },
  },
  kg: {
    tags: ["hard", "kg-general-partner", "two-layers"],
    kg: true,
    build: (rng, names) => {
      const limited = persons(names, pick(rng, [[30, 25, 45], [20, 20, 20, 20, 20], [40, 35, 25], [25, 25, 25, 25]]));
      // Half the time the general partner's owner is a small limited partner, who qualifies only through it.
      const small = limited.filter((h) => h.pct <= 25);
      const gpOwner = rng() < 0.5 && small.length > 0 ? pick(rng, small).holder : names.person();
      const gp = names.generalPartner();
      return {
        holders: limited,
        generalPartner: gp,
        // v2.1: drop [75, 25]. Only a minority above 25% (e.g. 40%) catches a model that
        // counts ">25% of the general partner" as ownership.
        entities: { [gp]: ownedBy(names, pick(rng, [[100], [60, 40], [75, 25]]), gpOwner) },
      };
    },
  },
  "no-control": {
    tags: ["hard", "no-control-50-50", "fallback", "two-layers"],
    // v2.1: wPct should be 60–80. At 40 or 50, a model that multiplies (50% × 50% = 25%)
    // also lands on the fallback, so the item passes it for the wrong reason.
    build: (rng, names) => {
      const wPct = pick(rng, [40, 50, 60]);
      const w = names.company();
      return { holders: [E(w, wPct), ...persons(names, smallStakes(rng, 100 - wPct))], entities: { [w]: ownedBy(names, [50, 50]) } };
    },
  },
};

/** How many of each kind make up the set (30 items): a third ordinary, the rest traps. */
export const QUOTA = { normal: 10, "nominal-boundary": 3, aggregation: 3, "two-vehicles": 3, "voting-rights": 3, "own-shares": 2, kg: 3, "no-control": 3 };

const CAPITALS = [25000, 50000, 100000, 40000, 60000];
const SUB_CAPITALS = [25000, 30000, 50000];

const toEuros = (capital) => (h) => {
  const { pct, ...rest } = h;
  return { ...rest, nominal: (capital * pct) / 100 };
};

/** Sometimes list one person's stake as two shares (R2). Euro amounts stay whole. */
function maybeSplit(rng, holders) {
  if (rng() >= 0.35) return holders;
  const i = holders.findIndex((h) => h.person && h.nominal >= 2000);
  if (i < 0) return holders;
  const first = Math.round((holders[i].nominal * pick(rng, [0.4, 0.5, 0.6])) / 100) * 100;
  return [...holders.slice(0, i), { ...holders[i], nominal: first }, ...holders.slice(i + 1), { ...holders[i], nominal: holders[i].nominal - first }];
}

export function buildStructure(rng, names, archetype) {
  const spec = ARCHETYPES[archetype];
  const target = spec.kg ? names.kg() : names.target();
  const capital = pick(rng, CAPITALS);
  const built = spec.build(rng, names, capital);
  const euros = built.euros ? built.holders.map(({ pct, ...h }) => ({ ...h, nominal: pct })) : maybeSplit(rng, built.holders.map(toEuros(capital)));
  const subEntities = Object.fromEntries(Object.entries(built.entities ?? {}).map(([name, hs]) => {
    const sub = pick(rng, SUB_CAPITALS);
    return [name, { capital: sub, holders: hs.map(toEuros(sub)) }];
  }));
  const ownShares = built.ownPct ? (capital * built.ownPct) / 100 : 0;
  const targetEntity = { capital, holders: euros, ownShares, ...(built.generalPartner ? { generalPartner: built.generalPartner } : {}) };

  const heldPersons = euros.filter((h) => h.person).map((h) => h.holder);
  const managers = rng() < 0.3 ? [pick(rng, heldPersons), names.person()] : rng() < 0.4 ? [names.person(), names.person()] : [names.person()];
  // A Prokurist is never also a Geschäftsführer; sometimes a shareholder, as a distractor for the fallback.
  const notManagers = heldPersons.filter((n) => !managers.includes(n));
  const prokura = rng() < 0.5 ? [rng() < 0.5 && notManagers.length > 0 ? pick(rng, notManagers) : names.person()] : [];
  const legalReps = built.generalPartner ? [built.generalPartner] : [...new Set(managers)];

  return {
    structure: { target, legalReps, entities: { [target]: targetEntity, ...subEntities } },
    register: { managers: [...new Set(managers)], prokura, kg: Boolean(spec.kg) },
    tags: spec.tags,
  };
}
