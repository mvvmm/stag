import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";

const sample = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("is reproducible for the same seed", () => {
    expect(sample(42, 100)).toEqual(sample(42, 100));
  });

  it("differs between seeds", () => {
    expect(sample(1, 10)).not.toEqual(sample(2, 10));
  });

  it("next() stays in [0, 1)", () => {
    for (const x of sample(7, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("range() stays in [min, max)", () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const x = rng.range(-2, 5);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(5);
    }
  });

  it("int() is inclusive and hits every value", () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const x = rng.int(1, 6);
      expect(Number.isInteger(x)).toBe(true);
      seen.add(x);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("pick() returns elements and throws on empty", () => {
    const rng = createRng(5);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });
});
