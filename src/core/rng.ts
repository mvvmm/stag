/**
 * Seeded PRNG (sfc32, seeded via splitmix32). All simulation randomness goes through an `Rng`
 * passed in by the caller; never use `Math.random` in simulation code.
 */
export type Rng = {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniformly random element; throws on an empty array. */
  pick<T>(items: readonly T[]): T;
};

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const seedNext = splitmix32(seed);
  let a = seedNext();
  let b = seedNext();
  let c = seedNext();
  let d = seedNext();

  const nextUint32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };

  const next = () => nextUint32() / 4294967296;

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick: empty array");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}
