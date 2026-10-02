import { describe, expect, it } from "vitest";
import { hitsCircle, hitsHurtbox, targetsIn } from "@/combat/shapes";
import { dmath } from "@/core/dmath";
import { createWorld } from "@/ecs/world";

const NORTH = { x: 0, z: 1 };
const O = { x: 0, z: 0 };

describe("circle", () => {
  const shape = { kind: "circle", center: O, radius: 2 } as const;

  it("hits a body it only grazes, not one just past it", () => {
    expect(hitsCircle(shape, { x: 2.5, z: 0 }, 0.5)).toBe(true);
    expect(hitsCircle(shape, { x: 2.51, z: 0 }, 0.5)).toBe(false);
    expect(hitsCircle(shape, { x: 0.3, z: -0.2 }, 0.1)).toBe(true);
  });
});

describe("line", () => {
  const shape = { kind: "line", origin: O, dir: NORTH, length: 5, halfWidth: 0.5 } as const;

  it("hits along its length and grazing its sides and ends", () => {
    expect(hitsCircle(shape, { x: 0, z: 3 }, 0.1)).toBe(true);
    expect(hitsCircle(shape, { x: 0.89, z: 3 }, 0.4)).toBe(true);
    expect(hitsCircle(shape, { x: 0.91, z: 3 }, 0.4)).toBe(false);
    expect(hitsCircle(shape, { x: 0, z: 5.39 }, 0.4)).toBe(true);
    expect(hitsCircle(shape, { x: 0, z: 5.41 }, 0.4)).toBe(false);
  });

  it("starts at its origin: nothing behind it", () => {
    expect(hitsCircle(shape, { x: 0, z: -0.5 }, 0.4)).toBe(false);
    expect(hitsCircle(shape, { x: 0, z: -0.3 }, 0.4)).toBe(true);
  });

  it("corners are square, not rounded", () => {
    // Diagonally off the far corner by 0.3 m along each axis: 0.42 m away.
    expect(hitsCircle(shape, { x: 0.8, z: 5.3 }, 0.41)).toBe(false);
    expect(hitsCircle(shape, { x: 0.8, z: 5.3 }, 0.43)).toBe(true);
  });
});

describe("cone", () => {
  const quarter = Math.PI / 4;
  const shape = { kind: "cone", origin: O, dir: NORTH, range: 4, halfAngle: quarter } as const;

  it("hits inside its angle up to range plus the body's radius", () => {
    expect(hitsCircle(shape, { x: 0, z: 4.29 }, 0.3)).toBe(true);
    expect(hitsCircle(shape, { x: 0, z: 4.31 }, 0.3)).toBe(false);
    expect(hitsCircle(shape, { x: 2, z: 2.1 }, 0.1)).toBe(true);
  });

  it("hits a body touching an edge from outside the angle, not one clear of it", () => {
    // A point at 60° from north, 2 m out: 15° past the 45° edge, so 2·sin 15° ≈ 0.52 m from it.
    const angle = Math.PI / 3;
    const at = { x: 2 * dmath.sin(angle), z: 2 * dmath.cos(angle) };
    expect(hitsCircle(shape, at, 0.5)).toBe(false);
    expect(hitsCircle(shape, at, 0.55)).toBe(true);
    expect(hitsCircle(shape, { x: -at.x, z: at.z }, 0.55)).toBe(true);
  });

  it("misses behind, but a body over its origin is hit", () => {
    expect(hitsCircle(shape, { x: 0, z: -1 }, 0.5)).toBe(false);
    expect(hitsCircle(shape, { x: 0, z: -0.3 }, 0.5)).toBe(true);
  });

  it("is a full circle at a half angle of 180°", () => {
    const round = { ...shape, halfAngle: Math.PI };
    expect(hitsCircle(round, { x: 0, z: -3 }, 0.1)).toBe(true);
    expect(hitsCircle(round, { x: 0, z: -4.2 }, 0.1)).toBe(false);
  });

  it("is the same turned any way", () => {
    for (let i = 0; i < 12; i++) {
      const yaw = (i * Math.PI) / 6;
      const dir = { x: dmath.sin(yaw), z: dmath.cos(yaw) };
      const turned = { ...shape, dir };
      const at = (r: number, off: number) => ({
        x: r * dmath.sin(yaw + off),
        z: r * dmath.cos(yaw + off),
      });
      expect(hitsCircle(turned, at(3, 0.7), 0.1)).toBe(true);
      expect(hitsCircle(turned, at(3, -0.7), 0.1)).toBe(true);
      expect(hitsCircle(turned, at(3, 1.2), 0.1)).toBe(false);
      expect(hitsCircle(turned, at(4.2, 0), 0.1)).toBe(false);
    }
  });
});

describe("hurtboxes", () => {
  it("a pill is hit along its whole length, following its facing", () => {
    const pill = { radius: 0.3, length: 2 };
    const shape = { kind: "circle", center: { x: 0, z: 1.4 }, radius: 0.5 } as const;
    // Facing north, its nose cap is centered at z = 0.7: 0.7 m from the circle's center.
    expect(hitsHurtbox(shape, pill, O, 0)).toBe(true);
    // Facing east, it lies along x and the circle is 1.4 m north of it.
    expect(hitsHurtbox(shape, pill, O, Math.PI / 2)).toBe(false);
  });

  it("targetsIn lists the bodies a shape touches, in world order", () => {
    const world = createWorld();
    const target = (x: number) =>
      world.add({
        transform: { position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        health: { current: 10, max: 10, taken: [] },
        hurtbox: { radius: 0.5, length: 0 },
      });
    const a = target(0);
    target(5);
    const c = target(-1.4);
    // No health: never a target.
    world.add({ transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } });
    const hit = targetsIn(world, { kind: "circle", center: O, radius: 1 });
    expect(hit).toEqual([a, c]);
  });
});
