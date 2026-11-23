/**
 * Per-item seeds. Every item draws from its own stream, derived from the
 * set's seed and the item's coordinates (split, kind, index), so growing one
 * split or one kind never changes another item. Noise draws from a second
 * stream of its own, so adding a noise type never moves a fact.
 */

/** FNV-1a over the string's UTF-16 code units: 32 bits, the same on every machine. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, seeded, the same on every machine. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The item's seed, and its two streams: one for the facts, one for the noise. */
export function itemStreams(setSeed, split, kind, index) {
  const seed = hash32(`${setSeed}:${split}:${kind}:${index}`);
  return { seed, facts: seeded(seed), noise: seeded(hash32(`${seed}:noise`)) };
}

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** k distinct entries of list, in list order. */
export function sample(rng, list, k) {
  const chosen = new Set();
  while (chosen.size < Math.min(k, list.length)) chosen.add(Math.floor(rng() * list.length));
  return list.filter((_, i) => chosen.has(i));
}
