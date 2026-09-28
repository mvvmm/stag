import { describe, expect, it } from "vitest";
import {
  boxCorners,
  fitShadowFrustum,
  fogAmount,
  type HeightFog,
  heightFogDensity,
  heightFogDepth,
  lightBasis,
  lightDirection,
  pulse,
} from "@/render/fogMath";

type Point = { x: number; y: number; z: number };

/** The optical depth by brute force: many small steps along the ray. */
function integrate(from: Point, to: Point, fog: HeightFog, steps = 20000): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    sum += heightFogDensity(from.y + (to.y - from.y) * t, fog);
  }
  return (sum * length) / steps;
}

const FOG: HeightFog = { density: 0.2, base: 0.5, falloff: 0.8 };
const camera = { x: 0, y: 14, z: -11 };

describe("heightFogDepth", () => {
  it("matches a numeric integration on rays down, up, level and across the base", () => {
    const rays: [Point, Point][] = [
      [camera, { x: 0, y: 0, z: 0 }],
      [camera, { x: 6, y: 3, z: 9 }],
      [{ x: 0, y: 0, z: 0 }, camera],
      [
        { x: 0, y: 0.2, z: 0 },
        { x: 10, y: 0.2, z: 0 },
      ],
      [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      [
        { x: 0, y: 0.3, z: 0 },
        { x: 3, y: 0.9, z: 4 },
      ],
      [
        { x: 0, y: 2, z: 0 },
        { x: 0.5, y: 2.00001, z: 3 },
      ],
    ];
    for (const [from, to] of rays) {
      expect(heightFogDepth(from, to, FOG)).toBeCloseTo(integrate(from, to, FOG), 4);
    }
  });

  it("is symmetric, and zero with no density", () => {
    const floor = { x: 3, y: 0, z: 2 };
    expect(heightFogDepth(camera, floor, FOG)).toBeCloseTo(heightFogDepth(floor, camera, FOG), 10);
    expect(heightFogDepth(camera, floor, { ...FOG, density: 0 })).toBe(0);
  });

  it("grows with the length of the ray and fades with height", () => {
    const near = heightFogDepth(camera, { x: 0, y: 0, z: 0 }, FOG);
    const far = heightFogDepth(camera, { x: 0, y: 0, z: 20 }, FOG);
    expect(far).toBeGreaterThan(near);
    const low = heightFogDepth(camera, { x: 0, y: 0.5, z: 0 }, FOG);
    const high = heightFogDepth(camera, { x: 0, y: 3, z: 0 }, FOG);
    expect(high).toBeLessThan(low);
  });

  it("with a tiny falloff, there's no fog above the base", () => {
    const thin = { ...FOG, falloff: 0.001 };
    expect(heightFogDepth(camera, { x: 0, y: 1, z: 0 }, thin)).toBeCloseTo(0, 6);
  });
});

describe("fogAmount", () => {
  it("goes from 0 toward 1", () => {
    expect(fogAmount(0)).toBe(0);
    expect(fogAmount(1)).toBeCloseTo(0.632, 3);
    expect(fogAmount(50)).toBeCloseTo(1, 10);
  });
});

describe("pulse", () => {
  it("stays within 1 ± amount and repeats every 1 / speed seconds", () => {
    for (let t = 0; t < 10; t += 0.013) {
      const value = pulse(t, 0.08, 0.3);
      expect(value).toBeGreaterThanOrEqual(0.92 - 1e-12);
      expect(value).toBeLessThanOrEqual(1.08 + 1e-12);
      expect(pulse(t + 1 / 0.3, 0.08, 0.3)).toBeCloseTo(value, 10);
    }
    expect(pulse(1.234, 0, 0.3)).toBe(1);
  });
});

describe("lightDirection", () => {
  it("shines away from its heading and down", () => {
    const fromNorth = lightDirection(0, 45);
    expect(fromNorth.z).toBeLessThan(0);
    expect(fromNorth.x).toBeCloseTo(0, 10);
    expect(fromNorth.y).toBeCloseTo(-Math.SQRT1_2, 10);
    const fromWest = lightDirection(-90, 30);
    expect(fromWest.x).toBeGreaterThan(0);
    expect(Math.hypot(fromWest.x, fromWest.y, fromWest.z)).toBeCloseTo(1, 10);
  });
});

describe("fitShadowFrustum", () => {
  const room = { min: { x: -16, y: 0, z: -11 }, max: { x: 16, y: 3, z: 11 } };

  it("contains every corner of the box, tightly, for any light direction", () => {
    for (let heading = -180; heading < 180; heading += 25) {
      for (const elevation of [15, 40, 55, 75, 90]) {
        const direction = lightDirection(heading, elevation);
        const frustum = fitShadowFrustum(room, direction);
        const basis = lightBasis(direction);
        const local = boxCorners(room).map((corner) => {
          const d = {
            x: corner.x - frustum.position.x,
            y: corner.y - frustum.position.y,
            z: corner.z - frustum.position.z,
          };
          const dot = (a: Point) => d.x * a.x + d.y * a.y + d.z * a.z;
          return { x: dot(basis.x), y: dot(basis.y), z: dot(basis.z) };
        });
        const eps = 1e-9;
        for (const p of local) {
          expect(p.x).toBeGreaterThanOrEqual(frustum.left - eps);
          expect(p.x).toBeLessThanOrEqual(frustum.right + eps);
          expect(p.y).toBeGreaterThanOrEqual(frustum.bottom - eps);
          expect(p.y).toBeLessThanOrEqual(frustum.top + eps);
          expect(p.z).toBeGreaterThanOrEqual(frustum.near - eps);
          expect(p.z).toBeLessThanOrEqual(frustum.far + eps);
        }
        // Tight: some corner touches each side.
        expect(Math.min(...local.map((p) => p.x))).toBeCloseTo(frustum.left, 9);
        expect(Math.max(...local.map((p) => p.y))).toBeCloseTo(frustum.top, 9);
        // The whole box is in front of the light.
        expect(frustum.near).toBeGreaterThanOrEqual(-eps);
      }
    }
  });

  it("has an orthonormal, left-handed basis like LookAtLH", () => {
    const { x, y, z } = lightBasis(lightDirection(-45, 55));
    const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(x, y)).toBeCloseTo(0, 10);
    expect(dot(y, z)).toBeCloseTo(0, 10);
    expect(dot(x, z)).toBeCloseTo(0, 10);
    // Up in the light's view points up in the world, and x is horizontal.
    expect(y.y).toBeGreaterThan(0);
    expect(x.y).toBeCloseTo(0, 10);
  });
});
