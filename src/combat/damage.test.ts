import { describe, expect, it } from "vitest";
import { applyDamage, clearDamageTaken } from "@/combat/damage";
import { createWorld } from "@/ecs/world";

describe("applyDamage", () => {
  it("takes health off, never below 0, and records every hit this tick", () => {
    const target = { health: { current: 100, max: 100, taken: [] as number[] } };
    applyDamage(target, 30);
    applyDamage(target, 80);
    expect(target.health.current).toBe(0);
    expect(target.health.taken).toEqual([30, 80]);
  });

  it("ignores zero, negative and NaN damage", () => {
    const target = { health: { current: 100, max: 100, taken: [] as number[] } };
    for (const amount of [0, -5, Number.NaN]) applyDamage(target, amount);
    expect(target.health).toEqual({ current: 100, max: 100, taken: [] });
  });

  it("clearDamageTaken forgets the hits, not the damage", () => {
    const world = createWorld();
    const target = world.add({ health: { current: 100, max: 100, taken: [] } });
    applyDamage(target, 10);
    clearDamageTaken(world);
    expect(target.health).toEqual({ current: 90, max: 100, taken: [] });
  });
});
