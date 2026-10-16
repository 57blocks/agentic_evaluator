/**
 * One builder per kind of case. Each returns the shareholder lists by entity;
 * solve.mjs decides the answer. Percentages are whole numbers and every
 * entity's shareholders add up to 100.
 */

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Split `total` among persons, each at most `cap`, in steps of 5. */
function smallStakes(rng, total, cap) {
  const parts = [];
  let left = total;
  while (left > 0) {
    const options = [10, 15, 20, cap].filter((n) => n <= Math.min(left, cap));
    const part = options.length === 0 ? left : pick(rng, options);
    parts.push(part);
    left -= part;
  }
  return parts;
}

const persons = (names, stakes) => stakes.map((percent) => ({ holder: names.person(), percent, person: true }));
const entity = (holder, percent) => ({ holder, percent, person: false });

const ARCHETYPES = {
  normal: {
    tags: ["normal"],
    build: (rng, names, target) => ({ [target]: persons(names, pick(rng, [[60, 40], [55, 45], [50, 30, 20], [45, 35, 20], [70, 30]])) }),
  },
  threshold: {
    tags: ["hard", "threshold-boundary"],
    build: (rng, names, target) => ({ [target]: persons(names, pick(rng, [[25, 75], [50, 25, 25], [40, 35, 25], [30, 25, 25, 20], [26, 25, 24, 25]])) }),
  },
  control: {
    tags: ["hard", "control-not-product", "two-layers"],
    build: (rng, names, target) => {
      const [held, controlled] = pick(rng, [[30, 55], [30, 60], [30, 70], [30, 80], [35, 60], [40, 55], [40, 60]]);
      const holding = names.company();
      return {
        [target]: [entity(holding, held), ...persons(names, smallStakes(rng, 100 - held, 20))],
        [holding]: persons(names, [controlled, 100 - controlled]),
      };
    },
  },
  "product-trap": {
    tags: ["hard", "product-not-control", "two-layers"],
    build: (rng, names, target) => {
      const held = pick(rng, [60, 70, 80]);
      const holding = names.company();
      return {
        [target]: [entity(holding, held), ...persons(names, smallStakes(rng, 100 - held, 20))],
        [holding]: persons(names, pick(rng, [[50, 50], [45, 30, 25], [40, 40, 20]])),
      };
    },
  },
  "small-holding": {
    tags: ["hard", "controlled-small-stake", "two-layers"],
    build: (rng, names, target) => {
      const held = pick(rng, [15, 20, 25]);
      const holding = names.company();
      const major = pick(rng, [35, 40, 45]);
      return {
        [target]: [entity(holding, held), ...persons(names, [major, ...smallStakes(rng, 100 - held - major, 20)])],
        [holding]: persons(names, pick(rng, [[100], [80, 20], [60, 40]])),
      };
    },
  },
  chain: {
    tags: ["hard", "control-chain", "three-layers"],
    build: (rng, names, target) => {
      const [upper, lower] = [names.company(), names.company()];
      const held = pick(rng, [30, 35, 40]);
      const lowerControl = pick(rng, [60, 75, 100]);
      const top = pick(rng, [55, 60, 70]);
      return {
        [target]: [entity(lower, held), ...persons(names, smallStakes(rng, 100 - held, 20))],
        [lower]: lowerControl === 100 ? [entity(upper, 100)] : [entity(upper, lowerControl), ...persons(names, [100 - lowerControl])],
        [upper]: persons(names, [top, 100 - top]),
      };
    },
  },
  fallback: {
    tags: ["hard", "fallback"],
    build: (rng, names, target) => ({ [target]: persons(names, pick(rng, [[20, 20, 20, 20, 20], [25, 25, 20, 15, 15], [24, 24, 22, 15, 15], [20, 20, 15, 15, 10, 10, 10]])) }),
  },
};

/** How many of each kind make up the set (30 items): a third ordinary, the rest traps. */
export const QUOTA = { normal: 10, threshold: 4, control: 4, "product-trap": 4, "small-holding": 2, chain: 3, fallback: 3 };

export function buildStructure(rng, names, archetype) {
  const spec = ARCHETYPES[archetype];
  const target = names.company();
  const holdings = spec.build(rng, names, target);
  const heldPersons = Object.values(holdings).flat().filter((s) => s.person).map((s) => s.holder);
  // Usually an outside managing director; sometimes one of the small shareholders, as a distractor.
  const directors = rng() < 0.3 && heldPersons.length > 0 ? [pick(rng, heldPersons)] : [names.person()];
  if (rng() < 0.3) directors.push(names.person());
  return { structure: { target, directors, holdings }, tags: spec.tags };
}
