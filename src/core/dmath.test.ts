import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { atan, atan2, cos, hypot, sin } from "@/core/dmath";

/** Within a couple of ulps of the platform result (which may itself be off by one). */
const close = (actual: number, expected: number) => {
  const tolerance = Math.max(Math.abs(expected), 1e-300) * 4.5e-16;
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

const samples = (() => {
  const values: number[] = [0, 1e-9, 0.1, 0.5, 0.7853981633974483, 1, 1.5707963267948966, 2, 3];
  let seed = 12345;
  for (let i = 0; i < 4000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    values.push((seed / 2 ** 32 - 0.5) * 2000);
  }
  return [...values, ...values.map((v) => -v)];
})();

describe("dmath", () => {
  it("sin and cos match Math to about 1 ulp over game-sized angles", () => {
    for (const x of samples) {
      const s = sin(x);
      const c = cos(x);
      expect(Math.abs(s - Math.sin(x)), `sin(${x})`).toBeLessThan(
        3e-16 * Math.max(1, Math.abs(x) / 100),
      );
      expect(Math.abs(c - Math.cos(x)), `cos(${x})`).toBeLessThan(
        3e-16 * Math.max(1, Math.abs(x) / 100),
      );
    }
    expect(sin(0)).toBe(0);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it("atan and atan2 match Math to about 1 ulp", () => {
    for (const x of samples) close(atan(x), Math.atan(x));
    for (let i = 0; i + 1 < samples.length; i += 2) {
      const [y, x] = [samples[i] as number, samples[i + 1] as number];
      close(atan2(y, x), Math.atan2(y, x));
      close(atan2(y / 1000, x), Math.atan2(y / 1000, x));
    }
  });

  it("atan2 has Math.atan2's special cases, signed zeros included", () => {
    const special = [0, -0, 1, -1, 2.5, -2.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const y of special) {
      for (const x of special) {
        const expected = Math.atan2(y, x);
        const actual = atan2(y, x);
        if (expected === 0) expect(Object.is(actual, expected), `atan2(${y}, ${x})`).toBe(true);
        else close(actual, expected);
      }
    }
    expect(atan2(Number.NaN, 1)).toBeNaN();
  });

  it("hypot is the plain square root of the sum of squares", () => {
    expect(hypot(3, 4)).toBe(5);
    for (const x of samples.slice(0, 200)) close(hypot(x, x / 3), Math.hypot(x, x / 3));
  });
});

// --- Determinism guard ------------------------------------------------------------------------

const SRC = fileURLToPath(new URL("..", import.meta.url));
/** Simulation code: systems, ECS, content data, nav, collision, scene sims (demo files except views), pure math. */
const SIM_PATHS = [
  "systems",
  "ecs",
  "data",
  "demo",
  "nav",
  "collision",
  "core/math.ts",
  "scenes/sim.ts",
  "scenes/sims.ts",
  "scenes/arena.ts",
];
const FORBIDDEN =
  /Math\.(random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b|[\w)\]]\s*\*\*\s*[\w(]/;

const files = (path: string): string[] =>
  statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => files(join(path, name)))
    : [path];

describe("simulation code", () => {
  it("uses dmath and the seeded Rng instead of engine-dependent Math functions", () => {
    const offenders: string[] = [];
    for (const path of SIM_PATHS.flatMap((p) => files(join(SRC, p)))) {
      if (!/\.tsx?$/.test(path) || /\.(test|view)\.tsx?$/.test(path)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "");
          if (FORBIDDEN.test(code) && !/^\s*(\*|\/\*)/.test(code)) {
            offenders.push(`${path.slice(SRC.length)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, "use `@/core/dmath` (and the passed-in Rng) in simulation code").toEqual([]);
  });
});
