import { afterEach, describe, expect, it } from "vitest";
import { gapTo, type Targetable } from "@/combat/abilities";
import { tuning } from "@/core/tuning";
import {
  type AbilityDef,
  type AbilityStats,
  CAT_AA,
  catAutoAttack,
  registerAbility,
} from "@/data/abilities";
import { addWithUid } from "@/ecs/uid";
import { type Caster, createWorld, type Entity, type Faction, type SlotId } from "@/ecs/world";
import { castingSystem } from "@/systems/casting";
import { PLAYER } from "@/systems/movementStats";

const DT = 1 / 60;

afterEach(() => tuning.reset());

/** A test ability: `stats` fills in the defaults. */
function ability(id: string, def: Partial<AbilityDef>, stats: Partial<AbilityStats>): AbilityDef {
  const full: AbilityDef = {
    id,
    label: id,
    aim: "direction",
    rootsWindup: false,
    rootsChannel: false,
    movingCancels: false,
    ...def,
    stats: () => ({ cooldown: 1, windup: 0, range: 5, channel: null, effects: [], ...stats }),
  };
  registerAbility(full);
  return full;
}

function setup(options: { faction?: Faction; slots?: Partial<Record<SlotId, string>> } = {}) {
  const world = createWorld();
  const slots: Caster["slots"] = {};
  for (const [slot, id] of Object.entries(options.slots ?? { primary: catAutoAttack.id })) {
    slots[slot as SlotId] = { ability: id, cooldown: 0 };
  }
  const caster = addWithUid(world, {
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    mover: { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 }, turnSide: 1 },
    faction: options.faction ?? "player",
    caster: { slots, cast: null, target: null, queued: null, casts: 0 },
  }) as Entity & Required<Pick<Entity, "caster" | "mover" | "transform" | "uid">>;
  const enemyFaction: Faction = caster.faction === "player" ? "enemy" : "player";
  const body = (x: number, z: number, faction: Faction = enemyFaction) =>
    addWithUid(world, {
      transform: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 } },
      health: { current: 1000, max: 1000, taken: [] },
      hurtbox: { radius: 0.6, length: 0 },
      faction,
    }) as Targetable;
  const tick = () => {
    for (const { health } of world.with("health")) health.taken.length = 0;
    castingSystem(world, DT);
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) tick();
  };
  return { world, caster, body, tick, ticks };
}

/** Ticks until `done` (at most `max`), returning how many it took. */
function until(tick: () => void, done: () => boolean, max = 600): number {
  for (let i = 1; i <= max; i++) {
    tick();
    if (done()) return i;
  }
  throw new Error("never happened");
}

const damage = (target: Targetable) => target.health.max - target.health.current;

describe("casting: the Cat's auto attack", () => {
  it("attacks its target once the windup is over, then again once the cooldown is", () => {
    const { caster, body, tick } = setup();
    const dummy = body(0, 2);
    caster.caster.target = dummy.uid;

    tick();
    expect(caster.caster.cast?.phase).toBe("windup");
    expect(caster.caster.casts).toBe(1);
    const period = 1 / CAT_AA.attackSpeed;
    expect(caster.caster.slots.primary?.cooldown).toBeCloseTo(period - 0, 6);

    const windupTicks = until(tick, () => damage(dummy) > 0) + 1;
    expect(windupTicks).toBe(Math.ceil((period * CAT_AA.windupShare) / DT - 1e-6) + 1);
    expect(dummy.health.taken).toEqual([CAT_AA.damage]);
    expect(caster.caster.cast).toBeNull();

    // The second attack starts one period after the first.
    const second = until(tick, () => caster.caster.casts === 2) + windupTicks;
    expect(second).toBe(Math.round(period / DT) + 1);
  });

  it("doesn't attack a target out of range, and does once it's in", () => {
    const { caster, body, tick, ticks } = setup();
    const dummy = body(0, 5);
    caster.caster.target = dummy.uid;
    ticks(120);
    expect(caster.caster.casts).toBe(0);
    expect(gapTo(caster, dummy)).toBeGreaterThan(CAT_AA.range);

    // Edge to edge: the caster's movement circle to the hurtbox.
    dummy.transform.position.z = PLAYER.radius + CAT_AA.range + 0.6 - 0.01;
    tick();
    expect(caster.caster.casts).toBe(1);
  });

  it("roots its caster during the windup, then lets it go", () => {
    const { caster, body, tick } = setup();
    caster.caster.target = body(0, 2).uid;
    caster.mover.desired = { x: 4, z: 0 };
    tick();
    expect(caster.mover.desired).toEqual({ x: 0, z: 0 });
    expect(caster.caster.cast?.face).toEqual({ x: 0, z: 1 });

    until(tick, () => caster.caster.cast === null);
    caster.mover.desired = { x: 4, z: 0 };
    tick();
    expect(caster.mover.desired).toEqual({ x: 4, z: 0 });
  });

  it("always lands once started, even if the target walks out of range", () => {
    const { caster, body, tick } = setup();
    const dummy = body(0, 2);
    caster.caster.target = dummy.uid;
    tick();
    dummy.transform.position.z = 30;
    until(tick, () => caster.caster.cast === null);
    expect(damage(dummy)).toBe(CAT_AA.damage);
  });

  it("drops a target that's gone or isn't an enemy", () => {
    const { world, caster, body, tick } = setup();
    const friend = body(0, 2, "player");
    caster.caster.target = friend.uid;
    tick();
    expect(caster.caster.target).toBeNull();
    expect(caster.caster.casts).toBe(0);

    const dummy = body(0, 2);
    caster.caster.target = dummy.uid;
    world.remove(dummy);
    tick();
    expect(caster.caster.target).toBeNull();
  });

  it("works the same for an enemy caster attacking a player body", () => {
    const { caster, body, tick } = setup({ faction: "enemy" });
    const player = body(1, 1, "player");
    caster.caster.target = player.uid;
    until(tick, () => damage(player) > 0);
    expect(damage(player)).toBe(CAT_AA.damage);
  });

  it("ignores cooldowns with the cheat", () => {
    const { caster, body, tick } = setup();
    caster.caster.target = body(0, 2).uid;
    caster.noCooldowns = true;
    until(tick, () => caster.caster.casts === 2, 60);
    expect(caster.caster.slots.primary?.cooldown).toBe(0);
  });
});

describe("casting: the framework", () => {
  it("goes off at once for an instant ability, hitting only enemies in its area", () => {
    const def = ability(
      "test.cone",
      { aim: "direction" },
      {
        effects: [
          { kind: "damage", amount: 7, area: { kind: "cone", range: 3, halfAngle: Math.PI / 4 } },
        ],
      },
    );
    const { caster, body, tick } = setup({ slots: { ability1: def.id } });
    const ahead = body(2, 0);
    const behind = body(-2, 0);
    const friend = body(1.5, 0, "player");
    caster.caster.queued = { slot: "ability1", age: 0, point: { x: 5, z: 0 }, target: null };
    tick();
    expect(damage(ahead)).toBe(7);
    expect(damage(behind)).toBe(0);
    expect(damage(friend)).toBe(0);
    expect(caster.caster.cast).toBeNull();
    expect(caster.caster.casts).toBe(1);
    expect(caster.caster.slots.ability1?.cooldown).toBe(1);
  });

  it("pulls a point aim in to the range and lands a circle there after its windup", () => {
    const def = ability(
      "test.point",
      { aim: "point", rootsWindup: true },
      {
        windup: 0.5,
        range: 4,
        effects: [
          { kind: "damage", amount: 5, area: { kind: "circle", radius: 0.5, at: "point" } },
        ],
      },
    );
    const { caster, body, tick } = setup({ slots: { ability2: def.id } });
    const there = body(0, 4.8);
    const far = body(0, 10);
    caster.caster.queued = { slot: "ability2", age: 0, point: { x: 0, z: 10 }, target: null };
    tick();
    expect(caster.caster.cast?.aim.point).toEqual({ x: 0, z: 4 });
    const ticks = until(tick, () => caster.caster.cast === null);
    expect(ticks).toBe(30);
    expect(damage(there)).toBe(5);
    expect(damage(far)).toBe(0);
  });

  it("channels: pulses every interval for the duration, after the windup", () => {
    const def = ability(
      "test.channel",
      { aim: "self", rootsChannel: true },
      {
        windup: 0.25,
        channel: { duration: 1, interval: 0.25 },
        effects: [{ kind: "damage", amount: 3, area: { kind: "circle", radius: 2, at: "caster" } }],
      },
    );
    const { caster, body, tick } = setup({ slots: { ultimate: def.id } });
    const near = body(1, 0);
    caster.caster.queued = { slot: "ultimate", age: 0, point: { x: 0, z: 0 }, target: null };
    tick();
    caster.mover.desired = { x: 1, z: 0 };
    until(tick, () => caster.caster.cast?.phase === "channel");
    // The windup doesn't root this one; the channel does.
    expect(caster.mover.desired).toEqual({ x: 0, z: 0 });
    until(tick, () => caster.caster.cast === null);
    expect(near.health.max - near.health.current).toBe(4 * 3);
    expect(caster.caster.cast).toBeNull();
  });

  it("cancels a channel that moving cancels when the caster wants to move", () => {
    const def = ability(
      "test.cancel",
      { aim: "self", movingCancels: true },
      {
        channel: { duration: 2, interval: 0.5 },
        effects: [{ kind: "damage", amount: 1, area: { kind: "circle", radius: 2, at: "caster" } }],
      },
    );
    const { caster, body, tick, ticks } = setup({ slots: { ability3: def.id } });
    const near = body(1, 0);
    caster.caster.queued = { slot: "ability3", age: 0, point: { x: 0, z: 0 }, target: null };
    ticks(31);
    expect(damage(near)).toBe(1);
    caster.mover.desired = { x: 1, z: 0 };
    tick();
    expect(caster.caster.cast).toBeNull();
    caster.mover.desired = { x: 0, z: 0 };
    ticks(120);
    expect(damage(near)).toBe(1);
  });

  it("buffers a press while the slot is on cooldown, for a moment", () => {
    const def = ability("test.buffer", { aim: "direction" }, { cooldown: 0.5 });
    const { caster, tick, ticks } = setup({ slots: { ability1: def.id } });
    const press = () => {
      caster.caster.queued = { slot: "ability1", age: 0, point: { x: 1, z: 0 }, target: null };
    };
    press();
    tick();
    expect(caster.caster.casts).toBe(1);

    // Pressed 0.15 s before it's ready: it goes as soon as it is.
    ticks(20);
    press();
    const waited = until(tick, () => caster.caster.casts === 2);
    expect(waited).toBe(10);

    // Pressed 0.3 s before: the buffer (0.2 s) runs out first.
    ticks(12);
    press();
    ticks(60);
    expect(caster.caster.casts).toBe(2);
  });
});
