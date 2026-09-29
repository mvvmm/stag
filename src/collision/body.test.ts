import { describe, expect, it } from "vitest";
import { footprintCircles, halfSpine } from "@/collision/body";
import { moveAndSlide, SKIN } from "@/collision/slide";
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
