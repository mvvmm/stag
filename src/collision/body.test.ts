import { describe, expect, it } from "vitest";
import { footprintCircles, halfSpine } from "@/collision/body";
import { bodyFits, fitBody, moveAndSlide, SKIN } from "@/collision/slide";
import { distanceToShape, type ObstacleShape } from "@/data/rooms/room";

const PILL = { radius: 0.3, length: 2 };
/** A wall along the X axis whose north face is at z = 0. */
const wall: ObstacleShape = { kind: "box", x: 0, z: -0.5, w: 20, d: 1, yaw: 0 };

/** How far the body's closest circle is from touching any of the shapes (negative: overlapping). */
const clearance = (at: { x: number; z: number }, circles: { x: number; z: number }[]) =>
  Math.min(
    ...circles.map((c) => distanceToShape({ x: at.x + c.x, z: at.z + c.z }, wall) - PILL.radius),
  );

describe("footprintCircles", () => {
  it("is one circle at the center for a circle footprint", () => {
    expect(footprintCircles({ radius: 0.4, length: 0.8 }, 1)).toEqual([{ x: 0, z: 0 }]);
    expect(footprintCircles({ radius: 0.4, length: 0 }, 1)).toEqual([{ x: 0, z: 0 }]);
  });

  it("lines a pill up along the facing, end caps at the spine's ends, half a radius apart", () => {
    const circles = footprintCircles(PILL, 0);
    const half = halfSpine(PILL);
    expect(half).toBeCloseTo(0.7);
    expect(circles[0]?.z).toBeCloseTo(-half);
    expect(circles.at(-1)?.z).toBeCloseTo(half);
    for (const c of circles) expect(c.x).toBeCloseTo(0);
    for (let i = 1; i < circles.length; i++) {
      const gap = (circles[i]?.z ?? 0) - (circles[i - 1]?.z ?? 0);
      expect(gap).toBeLessThanOrEqual(PILL.radius / 2 + 1e-12);
    }
    const east = footprintCircles(PILL, Math.PI / 2);
    expect(east.at(-1)?.x).toBeCloseTo(half);
    expect(east.at(-1)?.z).toBeCloseTo(0);
  });
});

describe("a pill in moveAndSlide", () => {
  it("stops nose first when running into a wall", () => {
    // Facing south, the nose 0.7 + 0.3 m ahead of the center.
    const circles = footprintCircles(PILL, Math.PI);
    const result = moveAndSlide([wall], { x: 0, z: 3 }, { x: 0, z: -3 }, PILL.radius, circles);
    expect(result.position.z).toBeCloseTo(halfSpine(PILL) + PILL.radius + SKIN, 9);
    expect(result.depenetrated).toBe(false);
  });

  it("slides along a wall side-on", () => {
    const circles = footprintCircles(PILL, Math.PI / 2);
    const from = { x: 0, z: PILL.radius + SKIN };
    const result = moveAndSlide([wall], from, { x: 0.2, z: -0.2 }, PILL.radius, circles);
    expect(result.position.x).toBeCloseTo(0.2, 9);
    expect(clearance(result.position, circles)).toBeGreaterThan(-SKIN);
  });
});

describe("bodyFits", () => {
  it("fits a body clear of everything", () => {
    expect(bodyFits([wall], { x: 0, z: 2 }, PILL.radius, footprintCircles(PILL, 0))).toBe(true);
  });

  it("doesn't fit a body whose end swung into a wall", () => {
    // Side-on against the wall, then turned 30° toward it: the nose dips in.
    const at = { x: 0, z: PILL.radius + 0.01 };
    expect(bodyFits([wall], at, PILL.radius, footprintCircles(PILL, Math.PI / 2))).toBe(true);
    const turned = footprintCircles(PILL, Math.PI / 2 + Math.PI / 6);
    expect(clearance(at, turned)).toBeLessThan(0);
    expect(bodyFits([wall], at, PILL.radius, turned)).toBe(false);
  });

  it("allows a skin of overlap, like the casts leave", () => {
    const at = { x: 0, z: PILL.radius - SKIN / 2 };
    expect(bodyFits([wall], at, PILL.radius, footprintCircles(PILL, Math.PI / 2))).toBe(true);
  });
});

describe("fitBody", () => {
  it("pushes a body whose end is in a wall a skin clear of it", () => {
    const at = { x: 0, z: PILL.radius + 0.01 };
    const turned = footprintCircles(PILL, Math.PI / 2 + Math.PI / 6);
    const fit = fitBody([wall], at, PILL.radius, turned);
    expect(fit.fits).toBe(true);
    expect(clearance(fit.position, turned)).toBeCloseTo(SKIN, 9);
  });

  it("doesn't fit a pill across a corridor narrower than it is long", () => {
    const north: ObstacleShape = { kind: "box", x: 0, z: 1.7, w: 20, d: 1, yaw: 0 };
    const fit = fitBody([wall, north], { x: 0, z: 0.6 }, PILL.radius, footprintCircles(PILL, 0));
    expect(fit.fits).toBe(false);
  });
});
