import { afterEach, describe, expect, it } from "vitest";
import { gapTo, type Targetable } from "@/combat/abilities";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import {
  ABILITIES,
  type AbilityDef,
  type AbilityStats,
  type AimKind,
  registerAbility,
} from "@/data/abilities";
import { createWorld, type SlotId } from "@/ecs/world";
import { type Action, emptyInputFrame, type InputFrame } from "@/input/actions";
import { yardSim } from "@/scenes/arena";
import { createSimulation } from "@/systems/simulation";

// The ability keys' cast modes and the walk into range, through the whole yard simulation:
// input → playerControl → casting → damage on the dummies. Test-only abilities fill the slots.

const DT = 1 / 60;

afterEach(() => tuning.reset());

function ability(
  id: string,
  aim: AimKind,
  stats: Partial<AbilityStats>,
  def: Partial<AbilityDef> = {},
): string {
  registerAbility({
    id,
    label: id,
    aim,
    rootsWindup: true,
    rootsChannel: false,
    movingCancels: false,
    interruptible: false,
    ...def,
    stats: () => ({ cooldown: 3, windup: 0.1, range: 5, channel: null, effects: [], ...stats }),
  });
  return id;
}

/** Q: a line. */
const LINE = ability("test.modes.line", "direction", {
  effects: [{ kind: "damage", amount: 10, area: { kind: "line", length: 8, halfWidth: 0.5 } }],
});
/** W: a circle at the point, which can be self cast. */
const BURST = ability(
  "test.modes.burst",
  "point",
  {
    range: 6,
    effects: [{ kind: "damage", amount: 20, area: { kind: "circle", radius: 1.5, at: "point" } }],
  },
  { selfCast: true },
);
/** E: on the caster, nothing to aim. */
const SELF = ability("test.modes.self", "self", { windup: 0 });
/** R: a targeted strike. */
const STRIKE = ability("test.modes.strike", "target", {
  range: 3,
  windup: 0.2,
  effects: [{ kind: "damage", amount: 50, area: null }],
});

function setup() {
  const world = createWorld();
  const rng = createRng(1);
  yardSim.spawn(world, rng);
  const simulation = createSimulation(world, rng, yardSim.systems);
  const player = world.with("player", "caster", "transform", "mover", "uid").first;
  const dummies = [...world.with("dummy", "uid", "health", "hurtbox", "transform")];
  const fixed = dummies.find((d) => d.dummy.kind === "static") as Targetable;
  const patrol = dummies.find((d) => d.dummy.kind === "patrol") as Targetable;
  if (!player || !fixed || !patrol) throw new Error("yard spawn changed");
  const slots: Partial<Record<SlotId, string>> = {
    ability1: LINE,
    ability2: BURST,
    ability3: SELF,
    ultimate: STRIKE,
  };
  for (const [slot, id] of Object.entries(slots)) {
    player.caster.slots[slot as SlotId] = { ability: id, cooldown: 0 };
  }
  /** Damage dealt to each dummy so far (dummies refill their health, so it can't tell). */
  const total = new Map<number, number>();
  const tick = (input: Partial<InputFrame> = {}) => {
    simulation.step(DT, { ...emptyInputFrame(), ...input });
    for (const d of dummies) {
      for (const amount of d.health.taken) total.set(d.uid, (total.get(d.uid) ?? 0) + amount);
    }
  };
  const dealt = (target: Targetable) => total.get(target.uid) ?? 0;
  const ticks = (n: number, input: Partial<InputFrame> = {}) => {
    for (let i = 0; i < n; i++) tick(input);
  };
  const place = (x: number, z: number) => {
    player.transform.position.x = x;
    player.transform.position.z = z;
  };
  return { world, player, fixed, patrol, tick, ticks, place, dealt };
}

const actions = (...list: Action[]) => new Set<Action>(list);
/** These actions going down this tick, with the cursor at `aim` over `hover`. */
const press = (
  list: Action[],
  aim = { x: 0, z: 0 },
  hover: number | null = null,
): Partial<InputFrame> => ({ pressed: actions(...list), held: actions(...list), aim, hover });
const rightClick = (at: { x: number; z: number }, hover: number | null = null) => ({
  ...press(["primary"], at, hover),
  moveCommand: at,
});
const bufferTicks = () => Math.ceil(ABILITIES.buffer / DT);

describe("quick cast", () => {
  it("the key alone casts at the cursor", () => {
    const { player, tick } = setup();
    tick(press(["ability1"], { x: 3, z: -5 }));
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.cast?.ability).toBe(LINE);
    expect(player.caster.cast?.aim.point).toEqual({ x: 3, z: -5 });
  });
});

describe("normal cast", () => {
  it("Shift + key aims without casting or spending the cooldown; a left click casts there", () => {
    const { player, tick, ticks } = setup();
    tick(press(["ability2", "normalCast"], { x: 1, z: -5 }));
    expect(player.player.aiming).toEqual({ slot: "ability2" });
    ticks(60);
    expect(player.caster.queued).toBeNull();
    expect(player.caster.casts).toBe(0);
    expect(player.caster.slots.ability2?.cooldown).toBe(0);

    tick(press(["confirm"], { x: -2, z: -3 }));
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.cast?.ability).toBe(BURST);
    expect(player.caster.cast?.aim.point).toEqual({ x: -2, z: -3 });
    expect(player.caster.slots.ability2?.cooldown).toBeGreaterThan(0);
  });

  it("aims during another cast, and the confirm waits for that cast to finish", () => {
    const { player, tick, ticks } = setup();
    tick(press(["ability2", "normalCast"]));
    tick(press(["ability1"], { x: 0, z: 5 }));
    // The other key cancelled the aiming and quick cast Q.
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.cast?.ability).toBe(LINE);
    // Q is still winding up: aiming is only UI, so it arms at once.
    tick(press(["ability2", "normalCast"]));
    expect(player.player.aiming).toEqual({ slot: "ability2" });
    expect(player.player.aimQueued).toBeUndefined();
    // The confirm queues W, which starts once Q is over.
    tick(press(["confirm"], { x: -2, z: -3 }));
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.cast?.ability).toBe(LINE);
    ticks(6);
    expect(player.caster.cast?.ability).toBe(BURST);
  });

  it("a press on cooldown arms once the slot is ready, within the buffer", () => {
    const { player, tick, ticks } = setup();
    const slot = player.caster.slots.ability2;
    if (!slot) throw new Error("no slot");
    slot.cooldown = 0.1;
    tick(press(["ability2", "normalCast"]));
    expect(player.player.aiming).toBeUndefined();
    ticks(6);
    expect(player.player.aiming).toEqual({ slot: "ability2" });
    expect(player.caster.casts).toBe(0);
  });

  it("a press on a longer cooldown is forgotten after the buffer", () => {
    const { player, tick, ticks } = setup();
    const slot = player.caster.slots.ability2;
    if (!slot) throw new Error("no slot");
    slot.cooldown = 1;
    tick(press(["ability2", "normalCast"]));
    ticks(bufferTicks());
    expect(player.player.aimQueued).toBeUndefined();
    ticks(60);
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.casts).toBe(0);
  });

  it("no cooldowns arms at once whatever the slot's cooldown says", () => {
    const { world, player, tick } = setup();
    world.addComponent(player, "noCooldowns", true);
    const slot = player.caster.slots.ability2;
    if (!slot) throw new Error("no slot");
    slot.cooldown = 5;
    tick(press(["ability2", "normalCast"]));
    expect(player.player.aiming).toEqual({ slot: "ability2" });
  });

  it("an ability aimed at self just casts", () => {
    const { player, tick } = setup();
    tick(press(["ability3", "normalCast"]));
    expect(player.player.aiming).toBeUndefined();
    expect(player.caster.casts).toBe(1);
    expect(player.caster.cast).toBeNull(); // instant
  });

  describe("cancels, without spending the cooldown", () => {
    const cancels: [string, Partial<InputFrame>][] = [
      ["a right-click (still a move order)", rightClick({ x: 4, z: -5 })],
      ["stop", press(["stop"])],
      ["Esc", press(["pause"])],
      ["the attack move", press(["attackMove"])],
    ];
    for (const [name, input] of cancels) {
      it(name, () => {
        const { player, tick, ticks } = setup();
        tick(press(["ability2", "normalCast"]));
        tick(input);
        expect(player.player.aiming).toBeUndefined();
        expect(player.caster.queued).toBeNull();
        expect(player.caster.slots.ability2?.cooldown).toBe(0);
        // A left click afterwards casts nothing.
        tick(press(["confirm"], { x: 0, z: -3 }));
        ticks(30);
        expect(player.caster.casts).toBe(0);
      });
    }

    it("the right-click still moves", () => {
      const { player, tick } = setup();
      tick(press(["ability2", "normalCast"]));
      tick(rightClick({ x: 4, z: -5 }));
      expect(player.player.order?.goal).toEqual({ x: 4, z: -5 });
    });

    it("the right-click on an enemy is still an attack order", () => {
      const { player, fixed, tick } = setup();
      tick(press(["ability2", "normalCast"]));
      tick(rightClick({ x: 0, z: 4 }, fixed.uid));
      expect(player.caster.target).toBe(fixed.uid);
      expect(player.player.chase).toBe(true);
    });

    it("a right-click still held from before doesn't cancel it", () => {
      const { player, tick } = setup();
      tick(rightClick({ x: 4, z: -5 }));
      tick({ ...press(["ability2", "normalCast"]), moveCommand: { x: 4, z: -5 } });
      tick({ held: actions("primary"), moveCommand: { x: 4, z: -5 } });
      expect(player.player.aiming).toEqual({ slot: "ability2" });
    });

    it("the same key without Shift quick casts it", () => {
      const { player, tick } = setup();
      tick(press(["ability2", "normalCast"]));
      tick(press(["ability2"], { x: 0, z: -2 }));
      expect(player.player.aiming).toBeUndefined();
      expect(player.caster.cast?.ability).toBe(BURST);
      expect(player.caster.cast?.aim.point).toEqual({ x: 0, z: -2 });
    });

    it("Shift + another key switches the aiming to it", () => {
      const { player, tick } = setup();
      tick(press(["ability2", "normalCast"]));
      tick(press(["ability1", "normalCast"]));
      expect(player.player.aiming).toEqual({ slot: "ability1" });
      expect(player.caster.casts).toBe(0);
    });

    it("an empty slot's key does nothing", () => {
      const { player, tick } = setup();
      tick(press(["ability2", "normalCast"]));
      tick(press(["extra1"]));
      tick(press(["extra2", "normalCast"]));
      expect(player.player.aiming).toEqual({ slot: "ability2" });
      expect(player.caster.casts).toBe(0);
    });
  });

  it("arming it disarms an armed attack move, and arming the attack move cancels it", () => {
    const { player, tick } = setup();
    tick(press(["attackMove"]));
    expect(player.player.attackMove?.armed).toBe(true);
    tick(press(["ability2", "normalCast"]));
    expect(player.player.attackMove).toBeNull();
    expect(player.player.aiming).toEqual({ slot: "ability2" });

    tick(press(["attackMove"]));
    expect(player.player.aiming).toBeUndefined();
    expect(player.player.attackMove?.armed).toBe(true);
    // The left click goes to the attack move, not a cast.
    tick(press(["confirm"], { x: 3, z: -5 }));
    expect(player.player.attackMove?.armed).toBe(false);
    expect(player.caster.queued).toBeNull();
    expect(player.caster.casts).toBe(0);
  });

  it("a confirm on a target out of range walks into range", () => {
    const { player, fixed, tick } = setup();
    tick(press(["ultimate", "normalCast"]));
    tick(press(["confirm"], { x: 0, z: 4 }, fixed.uid));
    expect(player.caster.queued?.chase).toBe(true);
    expect(player.player.order).not.toBeNull();
  });
});

describe("self cast", () => {
  it("Alt + key lands an ability that allows it at the caster's feet", () => {
    const { player, tick, place } = setup();
    place(2, -4);
    tick(press(["ability2", "selfCast"], { x: -3, z: 0 }));
    expect(player.caster.cast?.ability).toBe(BURST);
    expect(player.caster.cast?.aim.point).toEqual({ x: 2, z: -4 });
  });

  it("Alt + key quick casts an ability that doesn't allow it", () => {
    const { player, tick } = setup();
    tick(press(["ability1", "selfCast"], { x: 3, z: -5 }));
    expect(player.caster.cast?.ability).toBe(LINE);
    expect(player.caster.cast?.aim.point).toEqual({ x: 3, z: -5 });
  });

  it("a self-cast press waits in the buffer like a quick cast", () => {
    const { player, tick, ticks, place } = setup();
    place(2, -4);
    tick(press(["ability1"], { x: 0, z: 5 }));
    tick(press(["ability2", "selfCast"]));
    ticks(6);
    expect(player.caster.cast?.ability).toBe(BURST);
    expect(player.caster.cast?.aim.point).toEqual({ x: 2, z: -4 });
  });
});

describe("walk into range", () => {
  it("a targeted cast on an enemy out of range walks up and casts", () => {
    const { player, fixed, tick, ticks, dealt } = setup();
    // From the spawn, 9 m south of the static dummy; the strike's range is 3 m.
    tick(press(["ultimate"], { x: 0, z: 4 }, fixed.uid));
    expect(player.caster.queued?.chase).toBe(true);
    // Long past the buffer, it's still on its way.
    ticks(bufferTicks() * 3);
    expect(player.caster.queued?.chase).toBe(true);
    expect(player.mover.velocity.z).toBeGreaterThan(0);
    let i = 0;
    while (player.caster.casts === 0 && i++ < 300) tick();
    expect(player.caster.cast?.ability).toBe(STRIKE);
    expect(gapTo(player, fixed)).toBeLessThanOrEqual(3);
    expect(gapTo(player, fixed)).toBeGreaterThan(2.8);
    expect(player.caster.queued).toBeNull();
    ticks(30);
    expect(dealt(fixed)).toBe(50);
  });

  it("follows a moving target", () => {
    const { player, patrol, tick, ticks, dealt } = setup();
    tick(press(["ultimate"], patrol.transform.position, patrol.uid));
    ticks(600);
    expect(dealt(patrol)).toBe(50);
    expect(player.caster.casts).toBe(1);
    expect(player.caster.queued).toBeNull();
  });

  it("a target in range casts at once, without walking", () => {
    const { player, fixed, tick, place } = setup();
    place(0, 1);
    tick(press(["ultimate"], { x: 0, z: 4 }, fixed.uid));
    expect(player.caster.cast?.ability).toBe(STRIKE);
    expect(player.player.order).toBeNull();
  });

  const cancels: [string, (ids: { patrol: number }) => Partial<InputFrame>][] = [
    ["a move order", () => rightClick({ x: 4, z: -5 })],
    ["an attack order", ({ patrol }) => rightClick({ x: 0, z: 0 }, patrol)],
    ["stop", () => press(["stop"])],
    ["another cast", () => press(["ability1"], { x: 5, z: -5 })],
    ["arming another cast", () => press(["ability2", "normalCast"])],
  ];
  for (const [name, input] of cancels) {
    it(`${name} cancels it`, () => {
      const { player, fixed, patrol, tick, ticks, dealt } = setup();
      tick(press(["ultimate"], { x: 0, z: 4 }, fixed.uid));
      ticks(10);
      tick(input({ patrol: patrol.uid }));
      expect(player.caster.queued?.slot).not.toBe("ultimate");
      ticks(600);
      expect(dealt(fixed)).toBe(0);
    });
  }

  it("an attack move cancels it once issued, and walks where it was sent", () => {
    const { player, fixed, tick, ticks, dealt } = setup();
    tick(press(["ultimate"], { x: 0, z: 4 }, fixed.uid));
    ticks(10);
    tick(press(["attackMove"]));
    tick(press(["confirm"], { x: 6, z: -6 }));
    expect(player.caster.queued).toBeNull();
    expect(player.player.order?.goal).toEqual({ x: 6, z: -6 });
    ticks(600);
    expect(dealt(fixed)).toBe(0);
  });

  it("stops when the target is no longer an enemy", () => {
    const { player, fixed, tick, ticks } = setup();
    tick(press(["ultimate"], { x: 0, z: 4 }, fixed.uid));
    ticks(10);
    fixed.faction = "player";
    tick();
    expect(player.caster.queued).toBeNull();
    expect(player.player.order).toBeNull();
  });

  it("a cast press with the cursor on nothing doesn't walk (it waits in the buffer)", () => {
    const { player, tick, ticks } = setup();
    tick(press(["ultimate"], { x: 0, z: 4 }));
    expect(player.caster.queued?.chase).toBeUndefined();
    expect(player.player.order).toBeNull();
    ticks(bufferTicks() + 1);
    expect(player.caster.queued).toBeNull();
  });
});
