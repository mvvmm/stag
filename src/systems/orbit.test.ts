import { describe, expect, it } from "vitest";
import { createWorld } from "@/ecs/world";
import { orbitSystem } from "@/systems/orbit";

const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

describe("orbitSystem", () => {
  it("moves entities around the center by speed * dt", () => {
    const world = createWorld();
    const entity = world.add({
      transform: transform(),
      orbit: { center: { x: 1, y: 2, z: 3 }, radius: 2, speed: Math.PI, angle: 0 },
    });

    orbitSystem(world, 0.25);
    orbitSystem(world, 0.25);

    expect(entity.orbit.angle).toBeCloseTo(Math.PI / 2);
    expect(entity.transform.position.x).toBeCloseTo(1);
    expect(entity.transform.position.y).toBeCloseTo(2);
    expect(entity.transform.position.z).toBeCloseTo(5);
  });

  it("ignores entities without an orbit", () => {
    const world = createWorld();
    const entity = world.add({ transform: transform() });

    orbitSystem(world, 1);

    expect(entity.transform).toEqual(transform());
  });
});
