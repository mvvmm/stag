import { describe, expect, it } from "vitest";
import { clipVelocity, moveAndSlide, SKIN } from "@/collision/slide";
import { rotateByYaw } from "@/core/math";
import { distanceToShape, type ObstacleShape } from "@/data/rooms/room";

const R = 0.4;
/** A wall along the X axis whose north face is at z = 0. */
const wall: ObstacleShape = { kind: "box", x: 0, z: -0.5, w: 20, d: 1, yaw: 0 };
const pillar: ObstacleShape = { kind: "circle", x: 0, z: 0, r: 1 };

const clearance = (p: { x: number; z: number }, shapes: ObstacleShape[]) =>
  Math.min(...shapes.map((s) => distanceToShape(p, s))) - R;

describe("moveAndSlide", () => {
  it("moves freely when nothing is in the way", () => {
    const result = moveAndSlide([wall], { x: 0, z: 2 }, { x: 1, z: 0.5 }, R);
    expect(result.position).toEqual({ x: 1, z: 2.5 });
    expect(result.contacts).toEqual([]);
    expect(result.touching).toEqual([]);
  });

  it("stops just short of a wall hit head-on", () => {
    const result = moveAndSlide([wall], { x: 0, z: 1 }, { x: 0, z: -1 }, R);
    expect(result.position.x).toBe(0);
    expect(result.position.z).toBeCloseTo(R + SKIN, 12);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.point.z).toBeCloseTo(0, 12);
    expect(result.touching).toEqual([{ x: 0, z: 1 }]);
    expect(result.depenetrated).toBe(false);
  });

  it("slides along a wall with the motion's part along it (projected)", () => {
    // Starting in contact, pushing in at 45°: only the along-wall half of the motion is kept.
    const from = { x: 0, z: R };
    const result = moveAndSlide([wall], from, { x: 0.1, z: -0.1 }, R);
    expect(result.position.x).toBeCloseTo(0.1, 12);
    expect(result.position.z).toBeCloseTo(R, 12);
  });

  it("head-on into a wall from contact doesn't move at all", () => {
    const result = moveAndSlide([wall], { x: 0, z: R }, { x: 0, z: -0.2 }, R);
    expect(result.position).toEqual({ x: 0, z: R });
  });

  it("slides round a pillar without catching", () => {
    let p = { x: -3, z: 0.3 };
    for (let i = 0; i < 120; i++) {
      p = moveAndSlide([pillar], p, { x: 0.1, z: 0 }, R).position;
      expect(clearance(p, [pillar])).toBeGreaterThan(-SKIN);
    }
    expect(p.x).toBeGreaterThan(2); // got past it
  });

  it("rounds a box corner", () => {
    const box: ObstacleShape = { kind: "box", x: 0, z: 0, w: 2, d: 2, yaw: 0.3 };
    let p = { x: -3, z: 0.9 };
    for (let i = 0; i < 80; i++) {
      p = moveAndSlide([box], p, { x: 0.1, z: 0 }, R).position;
      expect(clearance(p, [box])).toBeGreaterThan(-SKIN);
    }
    expect(p.x).toBeGreaterThan(2);
  });

  it("stops in a wedge", () => {
    // Two 8 m walls from the origin at ±15°, a V opening east; push west into its point.
    const arm = (angle: number): ObstacleShape => ({
      kind: "box",
      x: 4 * Math.cos(angle),
      z: 4 * Math.sin(angle),
      w: 8,
      d: 0.5,
      yaw: -angle,
    });
    const a = arm(0.26);
    const b = arm(-0.26);
    let p = { x: 6, z: 0 };
    let last = p;
    for (let i = 0; i < 200; i++) {
      last = p;
      const result = moveAndSlide([a, b], p, { x: -0.12, z: 0.01 }, R);
      p = result.position;
      expect(result.depenetrated).toBe(false);
    }
    expect(Math.abs(p.x - last.x)).toBeLessThan(1e-9);
    expect(clearance(p, [a, b])).toBeGreaterThan(-SKIN);
  });

  it("can't tunnel through the thinnest wall at any speed", () => {
    const thin: ObstacleShape = { kind: "box", x: 0, z: 0, w: 10, d: 0.05, yaw: 0.4 };
    const result = moveAndSlide([thin], { x: 0, z: -3 }, { x: 1, z: 1000 / 60 }, R);
    expect(distanceToShape(result.position, thin)).toBeGreaterThan(R - SKIN);
    // Still on the south side of the wall's line (it may have slid off the end, but not through).
    const local = rotateByYaw(result.position, -thin.yaw);
    expect(local.z).toBeLessThan(0);
  });

  it("fits through a corridor just wider than the circle, not one just narrower", () => {
    const corridor = (width: number): ObstacleShape[] => [
      { kind: "box", x: -1 - width / 2, z: 0, w: 2, d: 6, yaw: 0 },
      { kind: "box", x: 1 + width / 2, z: 0, w: 2, d: 6, yaw: 0 },
    ];
    const walk = (shapes: ObstacleShape[]) => {
      let p = { x: 0, z: -5 };
      for (let i = 0; i < 100; i++) p = moveAndSlide(shapes, p, { x: 0, z: 0.12 }, R).position;
      return p;
    };
    expect(walk(corridor(0.82)).z).toBeGreaterThan(4);
    expect(walk(corridor(0.79)).z).toBeLessThan(-3);
  });

  it("pushes out of an overlap, even without moving", () => {
    const result = moveAndSlide([pillar], { x: 1.1, z: 0 }, { x: 0, z: 0 }, R);
    expect(result.depenetrated).toBe(true);
    expect(result.position.x).toBeCloseTo(1 + R, 12);
  });

  it("is deterministic", () => {
    const shapes = [wall, pillar];
    const a = moveAndSlide(shapes, { x: -2, z: 2 }, { x: 3, z: -2.5 }, R);
    const b = moveAndSlide(shapes, { x: -2, z: 2 }, { x: 3, z: -2.5 }, R);
    expect(a).toEqual(b);
  });
});

describe("clipVelocity", () => {
  it("removes only the part into the surface", () => {
    const v = { x: 3, z: -4 };
    clipVelocity(v, [{ x: 0, z: 1 }]);
    expect(v).toEqual({ x: 3, z: 0 });
    const away = { x: 3, z: 4 };
    clipVelocity(away, [{ x: 0, z: 1 }]);
    expect(away).toEqual({ x: 3, z: 4 });
  });

  it("stops in a wedge", () => {
    const v = { x: -5, z: 0.1 };
    const d = Math.SQRT1_2;
    clipVelocity(v, [
      { x: d, z: d },
      { x: d, z: -d },
    ]);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });
});
