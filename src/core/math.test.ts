import { describe, expect, it } from "vitest";
import { lerp, lerpAngle, TAU, wrapAngle } from "@/core/math";

describe("lerp", () => {
  it("interpolates linearly", () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(lerp(2, 4, 1)).toBe(4);
  });
});

describe("wrapAngle", () => {
  it("wraps into [-PI, PI)", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(TAU + 1)).toBeCloseTo(1);
    expect(wrapAngle(-TAU - 1)).toBeCloseTo(-1);
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI);
  });
});

describe("lerpAngle", () => {
  it("takes the shortest arc across the wrap point", () => {
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    expect(lerpAngle(a, b, 0.5)).toBeCloseTo(Math.PI);
    expect(lerpAngle(a, b, 1)).toBeCloseTo(Math.PI + 0.1);
  });

  it("handles unwrapped angles that grow past TAU", () => {
    expect(lerpAngle(10 * TAU, 10 * TAU + 0.2, 0.5)).toBeCloseTo(10 * TAU + 0.1);
  });
});
