import { afterEach, describe, expect, it } from "vitest";
import type { Targetable } from "@/combat/abilities";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { abilityById, catAutoAttack } from "@/data/abilities";
import { TEST_KIT, TEST_KIT_SLOTS } from "@/data/testKit";
import { addWithUid } from "@/ecs/uid";
import { createWorld, type Entity, type SlotId } from "@/ecs/world";
import { yardSim } from "@/scenes/arena";
import { castingSystem } from "@/systems/casting";

const DT = 1 / 60;

afterEach(() => tuning.reset());

function setup() {
  const world = createWorld();
  const player = addWithUid(world, {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    mover: { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 }, turnSide: 1 },
    faction: "player",
    player: { order: null, orders: 0, click: null, chase: false, attackMove: null },
    caster: {
      slots: { primary: { ability: catAutoAttack.id, cooldown: 0 } },
      cast: null,
      target: null,
      queued: null,
      casts: 0,
    },
  }) as Entity & Required<Pick<Entity, "caster" | "mover" | "player" | "uid">>;
  const dummy = (x: number, z: number) =>
    addWithUid(world, {
      transform: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 } },
      health: { current: 1000, max: 1000, taken: [] },
      hurtbox: { radius: 0.6, length: 0 },
      faction: "enemy",
    }) as Targetable;
  const testKit = () => {
    for (const [slot, ability] of Object.entries(TEST_KIT_SLOTS)) {
      player.caster.slots[slot as SlotId] = { ability, cooldown: 0 };
    }
  };
  const tick = () => {
    for (const { health } of world.with("health")) health.taken.length = 0;
    castingSystem(world, DT);
  };
  /** Casts `slot` like a quick cast at `point` (and `target`), and ticks until it's over. */
  const cast = (slot: SlotId, point: { x: number; z: number }, target: number | null = null) => {
    player.caster.queued = { slot, age: 0, point, target };
    player.mover.desired = { x: 3, z: 0 };
    tick();
    expect(player.caster.cast?.slot).toBe(slot);
    // Rooted during the windup.
    expect(player.mover.desired).toEqual({ x: 0, z: 0 });
    for (let i = 0; i < 120 && player.caster.cast; i++) tick();
    expect(player.caster.cast).toBeNull();
  };
  return { world, player, dummy, testKit, cast };
}

const damage = (target: Targetable) => target.health.max - target.health.current;

describe("the test kit", () => {
  it("is in the Cat's Q/W/E/R from the start, with D/F empty", () => {
    const world = createWorld();
    yardSim.spawn(world, createRng(1));
    const cat = world.with("player", "caster").first;
    expect(cat?.caster.slots.primary?.ability).toBe(catAutoAttack.id);
    for (const [slot, id] of Object.entries(TEST_KIT_SLOTS)) {
      expect(cat?.caster.slots[slot as SlotId]).toEqual({ ability: id, cooldown: 0 });
      expect(abilityById(id)).toBeDefined();
    }
    expect(cat?.caster.slots.extra1).toBeUndefined();
    expect(cat?.caster.slots.extra2).toBeUndefined();
  });
});

describe("the test kit's abilities", () => {
  it("Q: the line hits along the aim, its full length", () => {
    const { dummy, testKit, cast } = setup();
    testKit();
    const far = dummy(TEST_KIT.lineLength, 0);
    const beside = dummy(2, 3);
    cast("ability1", { x: 2, z: 0 });
    expect(far.health.taken).toEqual([TEST_KIT.lineDamage]);
    expect(damage(beside)).toBe(0);
  });

  it("W: the burst lands at the point, pulled in to its range", () => {
    const { dummy, testKit, cast } = setup();
    testKit();
    const atRange = dummy(0, TEST_KIT.burstRange);
    const near = dummy(0, 1);
    cast("ability2", { x: 0, z: 20 });
    expect(atRange.health.taken).toEqual([TEST_KIT.burstDamage]);
    expect(damage(near)).toBe(0);
  });

  it("E: the cone hits in front and to the side, not behind", () => {
    const { dummy, testKit, cast } = setup();
    testKit();
    const front = dummy(2, 0);
    const side = dummy(1.5, 1.2);
    const behind = dummy(-2, 0);
    cast("ability3", { x: 5, z: 0 });
    expect(front.health.taken).toEqual([TEST_KIT.coneDamage]);
    expect(side.health.taken).toEqual([TEST_KIT.coneDamage]);
    expect(damage(behind)).toBe(0);
  });

  it("R: the strike hits only its target", () => {
    const { dummy, testKit, cast } = setup();
    testKit();
    const target = dummy(0, 4);
    const other = dummy(0.5, 4);
    cast("ultimate", { x: 0, z: 4 }, target.uid);
    expect(target.health.taken).toEqual([TEST_KIT.strikeDamage]);
    expect(damage(other)).toBe(0);
  });
});
