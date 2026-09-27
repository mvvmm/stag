import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { cloneTransform, createWorld, snapTransform } from "@/ecs/world";
import { emptyInputFrame, type InputFrame } from "@/input/actions";
import { createSimulation, type NamedSystem, type System } from "@/systems/simulation";

const named = (...systems: System[]): NamedSystem[] =>
  systems.map((run, i) => ({ name: `s${i}`, run }));

const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

describe("createSimulation", () => {
  it("runs systems in order with the fixed dt", () => {
    const world = createWorld();
    const calls: string[] = [];
    const a: System = (_w, dt) => calls.push(`a:${dt}`);
    const b: System = (_w, dt) => calls.push(`b:${dt}`);

    createSimulation(world, createRng(1), named(a, b)).step(0.5, emptyInputFrame());

    expect(calls).toEqual(["a:0.5", "b:0.5"]);
  });

  it("snapshots transforms before systems move them", () => {
    const world = createWorld();
    const entity = world.add({ transform: transform(), prevTransform: transform() });
    const moveX: System = (w, dt) => {
      for (const e of w.with("transform")) e.transform.position.x += 10 * dt;
    };
    const sim = createSimulation(world, createRng(1), named(moveX));

    sim.step(0.1, emptyInputFrame());
    sim.step(0.1, emptyInputFrame());

    expect(entity.prevTransform.position.x).toBeCloseTo(1);
    expect(entity.transform.position.x).toBeCloseTo(2);
  });

  it("passes the tick's input to every system", () => {
    const world = createWorld();
    const seen: InputFrame[] = [];
    const record: System = (_w, _dt, _rng, input) => seen.push(input);
    const input = emptyInputFrame();

    createSimulation(world, createRng(1), named(record, record)).step(0.5, input);

    expect(seen).toEqual([input, input]);
    expect(seen[0]).toBe(input);
  });

  it("wraps each system call with the around hook", () => {
    const world = createWorld();
    const calls: string[] = [];
    const a: System = () => calls.push("a");
    const b: System = () => calls.push("b");
    const around = (name: string, run: () => void) => {
      calls.push(`<${name}`);
      run();
      calls.push(`${name}>`);
    };

    createSimulation(world, createRng(1), named(a, b), { around }).step(0.5, emptyInputFrame());

    expect(calls).toEqual(["<s0", "a", "s0>", "<s1", "b", "s1>"]);
  });

  it("is deterministic for the same seed", () => {
    const run = () => {
      const world = createWorld();
      const entity = world.add({ transform: transform() });
      const jitter: System = (w, _dt, rng) => {
        for (const e of w.with("transform")) e.transform.position.x += rng.range(-1, 1);
      };
      const sim = createSimulation(world, createRng(123), named(jitter));
      for (let i = 0; i < 50; i++) sim.step(1 / 60, emptyInputFrame());
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
