import { afterEach, describe, expect, it } from "vitest";
import { applyDamage } from "@/combat/damage";
import { tuning } from "@/core/tuning";
import { createWorld } from "@/ecs/world";
import { DUMMY, dummySystem } from "@/systems/dummy";

function dummy() {
  const world = createWorld();
  const max = DUMMY.maxHealth;
  const entity = world.add({
    health: { current: max, max, taken: [] },
    dummy: { kind: "static", sinceHit: 0, lastHealth: max },
  });
  return { world, entity };
}

/** Runs the dummy system for `seconds` in ticks of `dt`. */
function run(world: ReturnType<typeof createWorld>, seconds: number, dt: number) {
  for (let t = 0; t < Math.round(seconds / dt); t++) dummySystem(world, dt);
}

afterEach(() => tuning.reset());

describe("dummy", () => {
  it.each([1 / 60, 1 / 30])("refills only once left alone for refillDelay (dt %s)", (dt) => {
    const { world, entity } = dummy();
    const delay = DUMMY.refillDelay;
    applyDamage(entity, 400);
    run(world, delay - 0.2, dt);
    expect(entity.health.current).toBe(DUMMY.maxHealth - 400);
    // Another hit restarts the wait.
    applyDamage(entity, 100);
    run(world, delay - 0.2, dt);
    expect(entity.health.current).toBe(DUMMY.maxHealth - 500);
    run(world, 0.3, dt);
    expect(entity.health.current).toBe(DUMMY.maxHealth);
  });

  it("counts any drop as a hit, like an edit in the entity pane", () => {
    const { world, entity } = dummy();
    run(world, 10, 1 / 60);
    entity.health.current = 1;
    dummySystem(world, 1 / 60);
    expect(entity.health.current).toBe(1);
  });

  it("follows the maxHealth tunable", () => {
    const { world, entity } = dummy();
    tuning.set("dummy.maxHealth", 50);
    dummySystem(world, 1 / 60);
    expect(entity.health).toMatchObject({ current: 50, max: 50 });
  });
});
