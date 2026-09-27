import { describe, expect, it } from "vitest";
import { createWorld } from "@/ecs/world";
import { spinSystem } from "@/systems/spin";

const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

describe("spinSystem", () => {
  it("rotates spinning entities by speed * dt", () => {
    const world = createWorld();
    const entity = world.add({ transform: transform(), spin: { speed: 2 } });

    spinSystem(world, 0.5);
    spinSystem(world, 0.25);

    expect(entity.transform.rotation.y).toBeCloseTo(1.5);
  });

  it("ignores entities without a spin component", () => {
    const world = createWorld();
    const entity = world.add({ transform: transform() });

    spinSystem(world, 1);

    expect(entity.transform.rotation.y).toBe(0);
  });
});
