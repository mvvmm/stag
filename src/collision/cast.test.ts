import { describe, expect, it } from "vitest";
import { castCircle, surfaceNormal } from "@/collision/cast";
import type { ObstacleShape } from "@/data/rooms/room";

const pillar: ObstacleShape = { kind: "circle", x: 0, z: 0, r: 1 };
const box: ObstacleShape = { kind: "box", x: 0, z: 0, w: 4, d: 2, yaw: 0 };
const R = 0.5;

describe("castCircle against a circle", () => {
  it("hits head-on where the circles touch", () => {
    const hit = castCircle({ x: -5, z: 0 }, { x: 10, z: 0 }, pillar, R);
    expect(hit?.t).toBeCloseTo(3.5 / 10, 12);
    expect(hit?.normal.x).toBeCloseTo(-1, 12);
    expect(hit?.normal.z).toBeCloseTo(0, 12);
  });

  it("grazes off-center with the normal at the contact", () => {
    const hit = castCircle({ x: -5, z: 1.2 }, { x: 10, z: 0 }, pillar, R);
    expect(hit).not.toBeNull();
    const n = hit?.normal ?? { x: 0, z: 0 };
    expect(Math.hypot(n.x, n.z)).toBeCloseTo(1, 12);
    expect(n.z).toBeCloseTo(1.2 / 1.5, 12);
  });

  it("misses when passing further than the two radii, when too short, or when moving away", () => {
    expect(castCircle({ x: -5, z: 1.6 }, { x: 10, z: 0 }, pillar, R)).toBeNull();
    expect(castCircle({ x: -5, z: 0 }, { x: 3, z: 0 }, pillar, R)).toBeNull();
    expect(castCircle({ x: -5, z: 0 }, { x: -3, z: 0 }, pillar, R)).toBeNull();
    expect(castCircle({ x: -5, z: 0 }, { x: 0, z: 0 }, pillar, R)).toBeNull();
  });

  it("an exact tangent pass is not a hit", () => {
    expect(castCircle({ x: -5, z: 1.5 }, { x: 10, z: 0 }, pillar, R)).toBeNull();
  });
});

describe("castCircle against a box", () => {
  it("hits a side head-on", () => {
    const hit = castCircle({ x: -5, z: 0.3 }, { x: 10, z: 0 }, box, R);
    expect(hit?.t).toBeCloseTo(2.5 / 10, 12);
    expect(hit?.normal).toEqual({ x: -1, z: 0 });
    const top = castCircle({ x: 1, z: 4 }, { x: 0, z: -4 }, box, R);
    expect(top?.t).toBeCloseTo(2.5 / 4, 12);
    expect(top?.normal).toEqual({ x: 0, z: 1 });
  });

  it("hits a rounded corner with a diagonal normal", () => {
    // Straight at the (2, 1) corner along the diagonal.
    const d = Math.SQRT1_2;
    const hit = castCircle({ x: 2 + 3 * d, z: 1 + 3 * d }, { x: -4 * d, z: -4 * d }, box, R);
    expect(hit?.t).toBeCloseTo(2.5 / 4, 12);
    expect(hit?.normal.x).toBeCloseTo(d, 12);
    expect(hit?.normal.z).toBeCloseTo(d, 12);
  });

  it("passes by a corner the square box would have clipped", () => {
    // Along x + z = 3.9: through (2.45, 1.45), inside the grown bounding square, but 0.64 m from
    // the (2, 1) corner, so clear of its 0.5 m rounding.
    expect(castCircle({ x: 3.45, z: 0.45 }, { x: -2, z: 2 }, box, R)).toBeNull();
  });

  it("works for rotated boxes", () => {
    const rotated: ObstacleShape = { ...box, x: 1, z: -2, yaw: Math.PI / 2 };
    // Rotated a quarter turn: 2 m along X, 4 m along Z.
    const hit = castCircle({ x: -5, z: -2 }, { x: 10, z: 0 }, rotated, R);
    expect(hit?.t).toBeCloseTo((6 - 1 - 0.5) / 10, 12);
    expect(hit?.normal.x).toBeCloseTo(-1, 12);
    expect(hit?.normal.z).toBeCloseTo(0, 12);
  });
});

describe("castCircle from contact", () => {
  const touching = { x: -2 - R, z: 0 };

  it("moving in hits at t = 0", () => {
    const hit = castCircle(touching, { x: 1, z: 0.5 }, box, R);
    expect(hit?.t).toBe(0);
    expect(hit?.normal).toEqual({ x: -1, z: 0 });
  });

  it("moving along or away is free", () => {
    expect(castCircle(touching, { x: 0, z: 1 }, box, R)).toBeNull();
    expect(castCircle(touching, { x: -1, z: 1 }, box, R)).toBeNull();
    expect(castCircle({ x: 0, z: 1.5 }, { x: 1, z: 0 }, pillar, R)).toBeNull();
  });

  it("overlapping and moving deeper hits at t = 0", () => {
    const hit = castCircle({ x: -1.2, z: 0 }, { x: 1, z: 0 }, pillar, R);
    expect(hit?.t).toBe(0);
    expect(hit?.normal.x).toBeCloseTo(-1, 12);
  });
});

describe("surfaceNormal", () => {
  it("points out of the nearest side from inside a box and away from the corner outside", () => {
    expect(surfaceNormal({ x: 1.8, z: 0 }, box)).toEqual({ x: 1, z: 0 });
    expect(surfaceNormal({ x: 0, z: -0.9 }, box)).toEqual({ x: 0, z: -1 });
    const n = surfaceNormal({ x: 3, z: 2 }, box);
    expect(n.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(n.z).toBeCloseTo(Math.SQRT1_2, 12);
  });
});
