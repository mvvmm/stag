import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { createWorld } from "@/ecs/world";
import { emptyInputFrame } from "@/input/actions";
import { yardSim } from "@/scenes/arena";
import { createSimulation } from "@/systems/simulation";

// The yard's patrolling dummy, through the real systems (patrol → locomotion).

function yard() {
  const world = createWorld();
  const rng = createRng(1);
  yardSim.spawn(world, rng);
  const simulation = createSimulation(world, rng, yardSim.systems);
  const walker = world.with("patrol", "transform").first;
  if (!walker) throw new Error("no patrolling dummy");
  return { simulation, walker };
}

describe.each([1 / 60, 1 / 30])("patrol (dt %s)", (dt) => {
  it("walks to both ends and back, on its segment", () => {
    const { simulation, walker } = yard();
    const { a, b } = walker.patrol;
    const input = emptyInputFrame();
    const reached = { a: 0, b: 0 };
    let last: "a" | "b" | null = null;
    for (let t = 0; t < Math.round(30 / dt); t++) {
      simulation.step(dt, input);
      const p = walker.transform.position;
      // On the line between the ends (the yard's route runs along x at z = 0), never past them.
      expect(Math.abs(p.z - a.z)).toBeLessThan(1e-9);
      expect(p.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - 1e-9);
      expect(p.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + 1e-9);
      const at = Math.abs(p.x - b.x) < 1e-6 ? "b" : Math.abs(p.x - a.x) < 1e-6 ? "a" : null;
      if (at && at !== last) {
        reached[at]++;
        last = at;
      }
    }
    // 10 m each way at 2 m/s plus pauses: several round trips in 30 s.
    expect(reached.b).toBeGreaterThanOrEqual(2);
    expect(reached.a).toBeGreaterThanOrEqual(2);
  });

  it("faces where it walks", () => {
    const { simulation, walker } = yard();
    for (let t = 0; t < Math.round(1 / dt); t++) simulation.step(dt, emptyInputFrame());
    // Heading east (+x) from a to b: yaw 90°.
    expect(walker.transform.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });
});
