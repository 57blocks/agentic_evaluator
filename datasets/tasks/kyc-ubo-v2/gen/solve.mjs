/**
 * The answer key, as code: RULES.md R1–R8. The generator builds a structure,
 * this decides who the beneficial owners are.
 *
 * A structure: { target, legalReps, entities }. Each entity lists its holders
 * as { holder, nominal (EUR), person, voting? }; shares the entity holds in
 * itself are not listed (R6), and a KG names its generalPartner (R7).
 */

/** Counts towards voting rights unless the share is non-voting (R1). */
const votes = (h) => (h.voting === false ? 0 : h.nominal);
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
/** Strictly more than a quarter / a half, in whole euros: no rounding. */
const overQuarter = (part, base) => base > 0 && part * 4 > base;
const overHalf = (part, base) => base > 0 && part * 2 > base;

/** Does `person` control `entity`: more than 50% of its votes, own or through controlled entities (R3–R5), or its general partner (R7)? */
export function controls(person, entityName, entities, seen = new Set()) {
  const entity = entities[entityName];
  if (entity === undefined || seen.has(entityName)) return false;
  const nextSeen = new Set([...seen, entityName]);
  if (entity.generalPartner && controls(person, entity.generalPartner, entities, nextSeen)) return true;
  const held = entity.holders.filter((h) => attributable(person, h, entities, nextSeen));
  return overHalf(sum(held, votes), sum(entity.holders, votes));
}

/** A holding counts as the person's if they hold it themselves or control the entity holding it, in full (R3). */
export function attributable(person, h, entities, seen) {
  return h.person ? h.holder === person : controls(person, h.holder, entities, seen);
}

export function naturalPersons(entities) {
  const all = Object.values(entities).flatMap((e) => e.holders.filter((h) => h.person).map((h) => h.holder));
  return [...new Set(all)];
}

function percent(part, base) {
  return `${((part / base) * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

/** Why `person` qualifies, or null. One ground is enough (FAQ Teil 1 B I Nr. 9). */
function ground(person, target, entities) {
  const t = entities[target];
  const held = t.holders.filter((h) => attributable(person, h, entities, new Set([target])));
  const capital = [sum(held, (h) => h.nominal), sum(t.holders, (h) => h.nominal)];
  const voting = [sum(held, votes), sum(t.holders, votes)];
  const through = held.some((h) => !h.person) ? " (incl. controlled entities)" : "";
  if (overQuarter(...capital)) return `${percent(...capital)} of capital${through}`;
  if (overQuarter(...voting)) return `${percent(...voting)} of voting rights${through}`;
  if (t.generalPartner && controls(person, t.generalPartner, entities)) return `controls the general partner ${t.generalPartner}`;
  return null;
}

/** @returns {{ beneficial_owners: Array<{ name: string, basis: string }>, fictitious_beneficial_owners: string[] }} */
export function solve({ target, legalReps, entities }) {
  const owners = naturalPersons(entities)
    .map((name) => ({ name, basis: ground(name, target, entities) }))
    .filter((o) => o.basis !== null);
  return { beneficial_owners: owners, fictitious_beneficial_owners: owners.length === 0 ? [...legalReps] : [] };
}
