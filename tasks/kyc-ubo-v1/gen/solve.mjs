/**
 * The rules every item is graded by, as code. The generator builds a structure,
 * this decides the answer — so a structure built for one trap is still graded
 * by the rules, not by what the generator meant it to show.
 *
 *   1. A natural person who holds more than 25% of the target directly is a
 *      beneficial owner ("direct"). Exactly 25% is not more than 25%.
 *   2. A natural person who controls an entity holding more than 25% of the
 *      target is a beneficial owner ("control"). Control means more than 50%
 *      of an entity (exactly 50% is not control), and passes down a chain of
 *      controlled entities.
 *   3. Multiplying stakes through a chain never makes anyone an owner; only
 *      rule 1 or rule 2 does.
 *   4. When nobody qualifies, every managing director is recorded instead.
 */

export const THRESHOLD = 25;
export const CONTROL = 50;

/**
 * @param {{ target: string, directors: string[], holdings: Record<string, Array<{ holder: string, percent: number, person: boolean }>> }} structure
 */
export function solve(structure) {
  const { target, directors, holdings } = structure;
  const owners = new Map();
  const addOwner = (name, basis) => {
    if (!owners.has(name)) owners.set(name, basis);
  };

  for (const s of holdings[target] ?? []) {
    if (s.percent <= THRESHOLD) continue;
    if (s.person) addOwner(s.holder, "direct");
    else for (const p of controllersOf(s.holder, holdings, new Set())) addOwner(p, "control");
  }

  const beneficialOwners = [...owners].map(([name, basis]) => ({ name, basis }));
  const isFallback = beneficialOwners.length === 0;
  return {
    beneficial_owners: beneficialOwners,
    fallback: isFallback,
    recorded_under_fallback: isFallback ? [...directors] : [],
  };
}

/** Natural persons who control `entity`, directly or down a chain of controlled entities. */
function controllersOf(entity, holdings, seen) {
  if (seen.has(entity)) return [];
  const nextSeen = new Set([...seen, entity]);
  return (holdings[entity] ?? [])
    .filter((s) => s.percent > CONTROL)
    .flatMap((s) => (s.person ? [s.holder] : controllersOf(s.holder, holdings, nextSeen)));
}
