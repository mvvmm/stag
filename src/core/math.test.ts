import { describe, expect, it } from "vitest";
import {
  lerp,
  lerpAngle,
  normalizeClamp,
  rayToGround,
  rotateByYaw,
  TAU,
  wrapAngle,
} from "@/core/math";

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

describe("rotateByYaw", () => {
  it("is the identity for yaw 0", () => {
    const v = rotateByYaw({ x: 1, z: 2 }, 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(2);
  });

  it("maps screen-up to the camera's forward direction", () => {
    // A camera yawed 90° looks along +X, so "up" on screen is +X in the world, and "right" is -Z.
    const up = rotateByYaw({ x: 0, z: 1 }, Math.PI / 2);
    expect(up.x).toBeCloseTo(1);
    expect(up.z).toBeCloseTo(0);
    const right = rotateByYaw({ x: 1, z: 0 }, Math.PI / 2);
    expect(right.x).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(-1);
  });
});

describe("normalizeClamp", () => {
  it("shortens vectors longer than 1", () => {
    const v = normalizeClamp({ x: 1, z: 1 });
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
  });

  it("leaves shorter vectors alone", () => {
    expect(normalizeClamp({ x: 0.3, z: 0 })).toEqual({ x: 0.3, z: 0 });
    expect(normalizeClamp({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });
});

describe("rayToGround", () => {
  it("intersects a downward ray with the plane", () => {
    const hit = rayToGround({ x: 0, y: 10, z: -10 }, { x: 0.5, y: -1, z: 1 }, 0);
    expect(hit).toEqual({ x: 5, z: 0 });
  });

  it("respects the plane height", () => {
    expect(rayToGround({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 1 }, 2)).toEqual({ x: 0, z: 8 });
  });

  it("returns null for rays that point away from or along the plane", () => {
    expect(rayToGround({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 1 }, 0)).toBeNull();
    expect(rayToGround({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 0)).toBeNull();
  });
});
