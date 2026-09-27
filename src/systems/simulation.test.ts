import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { cloneTransform, createWorld, snapTransform } from "@/ecs/world";
import { createSimulation, type System } from "@/systems/simulation";

const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

describe("createSimulation", () => {
  it("runs systems in order with the fixed dt", () => {
    const world = createWorld();
    const calls: string[] = [];
    const a: System = (_w, dt) => calls.push(`a:${dt}`);
    const b: System = (_w, dt) => calls.push(`b:${dt}`);

    createSimulation(world, createRng(1), [a, b]).step(0.5);

    expect(calls).toEqual(["a:0.5", "b:0.5"]);
  });

  it("snapshots transforms before systems move them", () => {
    const world = createWorld();
    const entity = world.add({ transform: transform(), prevTransform: transform() });
    const moveX: System = (w, dt) => {
      for (const e of w.with("transform")) e.transform.position.x += 10 * dt;
    };
    const sim = createSimulation(world, createRng(1), [moveX]);

    sim.step(0.1);
    sim.step(0.1);

    expect(entity.prevTransform.position.x).toBeCloseTo(1);
    expect(entity.transform.position.x).toBeCloseTo(2);
  });

  it("is deterministic for the same seed", () => {
    const run = () => {
      const world = createWorld();
      const entity = world.add({ transform: transform() });
      const jitter: System = (w, _dt, rng) => {
        for (const e of w.with("transform")) e.transform.position.x += rng.range(-1, 1);
      };
      const sim = createSimulation(world, createRng(123), [jitter]);
      for (let i = 0; i < 50; i++) sim.step(1 / 60);
      return entity.transform.position.x;
    };
    expect(run()).toBe(run());
  });
});

describe("snapTransform", () => {
  it("copies the current transform into prevTransform", () => {
    const current = transform();
    current.position.x = 5;
    current.rotation.y = 1;
    const entity = { transform: current, prevTransform: transform() };

    snapTransform(entity);

    expect(entity.prevTransform).toEqual(cloneTransform(current));
    expect(entity.prevTransform).not.toBe(current);
  });
});
