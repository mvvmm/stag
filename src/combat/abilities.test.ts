import { describe, expect, it } from "vitest";
import { enemyOf, resolveAim } from "@/combat/abilities";
import type { AbilityDef, AbilityStats, AimKind } from "@/data/abilities";
import { addWithUid } from "@/ecs/uid";
import { createWorld, type Entity } from "@/ecs/world";

const STATS: AbilityStats = { cooldown: 1, windup: 0, range: 4, channel: null, effects: [] };

const def = (aim: AimKind, selfCast?: boolean): AbilityDef => ({
  id: `test.${aim}`,
  label: aim,
  aim,
  rootsWindup: false,
  rootsChannel: false,
  movingCancels: false,
  interruptible: false,
  selfCast,
  stats: () => STATS,
});

function setup() {
  const world = createWorld();
  const caster = addWithUid(world, {
    transform: { position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 } },
    faction: "player",
    health: { current: 100, max: 100, taken: [] },
    hurtbox: { radius: 0.5, length: 0 },
  }) as Entity & { uid: number };
  return { world, caster };
}

describe("resolveAim: self casts", () => {
  it("a self-castable target aim targets the caster", () => {
    const { world, caster } = setup();
    const request = { point: { x: 9, z: 9 }, target: null, self: true };
    expect(resolveAim(world, def("target", true), STATS, caster, request)).toEqual({
      target: caster.uid,
      point: null,
      dir: null,
    });
  });

  it("a self-castable point aim lands at the caster's feet", () => {
    const { world, caster } = setup();
    const request = { point: { x: 9, z: 9 }, target: null, self: true };
    expect(resolveAim(world, def("point", true), STATS, caster, request)).toEqual({
      target: null,
      point: { x: 1, z: 2 },
      dir: null,
    });
  });

  it("the flag does nothing for abilities without selfCast", () => {
    const { world, caster } = setup();
    const request = { point: { x: 1, z: 9 }, target: caster.uid, self: true };
    expect(resolveAim(world, def("target"), STATS, caster, request)).toBeNull();
    // The point is pulled in to the range as usual.
    expect(resolveAim(world, def("point"), STATS, caster, request)?.point).toEqual({ x: 1, z: 6 });
  });

  it("without the flag a target aim on the caster is rejected, and enemyOf still rejects it", () => {
    const { world, caster } = setup();
    const request = { point: { x: 1, z: 2 }, target: caster.uid };
    expect(resolveAim(world, def("target", true), STATS, caster, request)).toBeNull();
    expect(enemyOf(world, caster, caster.uid)).toBeUndefined();
  });
});
