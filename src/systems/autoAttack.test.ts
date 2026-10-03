import { afterEach, describe, expect, it } from "vitest";
import { gapTo, type Targetable } from "@/combat/abilities";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { CAT_AA } from "@/data/abilities";
import { createWorld } from "@/ecs/world";
import { type Action, emptyInputFrame, type InputFrame } from "@/input/actions";
import { yardSim } from "@/scenes/arena";
import { createSimulation } from "@/systems/simulation";

// The auto attack through the whole yard simulation: input → playerControl's target rules (both
// schemes) → casting → damage on the dummies.

const DT = 1 / 60;

afterEach(() => tuning.reset());

function setup() {
  const world = createWorld();
  const rng = createRng(1);
  yardSim.spawn(world, rng);
  const simulation = createSimulation(world, rng, yardSim.systems);
  const player = world.with("player", "caster", "transform", "mover").first;
  const dummies = [...world.with("dummy", "uid", "health", "hurtbox", "transform")];
  const fixed = dummies.find((d) => d.dummy.kind === "static") as Targetable;
  const patrol = dummies.find((d) => d.dummy.kind === "patrol") as Targetable;
  if (!player || !fixed || !patrol) throw new Error("yard spawn changed");
  const total = { [fixed.uid]: 0, [patrol.uid]: 0 };
  const tick = (input: Partial<InputFrame> = {}) => {
    simulation.step(DT, { ...emptyInputFrame(), ...input });
    for (const d of [fixed, patrol]) {
      for (const amount of d.health.taken) total[d.uid] = (total[d.uid] ?? 0) + amount;
    }
  };
  const ticks = (n: number, input: Partial<InputFrame> = {}) => {
    for (let i = 0; i < n; i++) tick(input);
  };
  const place = (x: number, z: number) => {
    player.transform.position.x = x;
    player.transform.position.z = z;
  };
  return { world, player, fixed, patrol, total, tick, ticks, place };
}

const actions = (...list: Action[]) => new Set<Action>(list);
/** The button going down this tick, with the cursor over `hover`. */
const click = (hover: number | null, action: Action = "primary"): Partial<InputFrame> => ({
  pressed: actions(action),
  held: actions(action),
  hover,
});
const hold = (hover: number | null, action: Action = "primary"): Partial<InputFrame> => ({
  held: actions(action),
  hover,
});
/** Seconds between attacks, in ticks. */
const period = () => Math.ceil(1 / CAT_AA.attackSpeed / DT);

describe("auto attack, WASD", () => {
  it("clicking an enemy in range attacks it, and keeps attacking after the release", () => {
    const { player, fixed, total, tick, ticks, place } = setup();
    place(0, 2.4);
    tick(click(fixed.uid));
    expect(player.caster.target).toBe(fixed.uid);
    ticks(period() * 3 - 1);
    expect(total[fixed.uid]).toBe(CAT_AA.damage * 3);
    expect(player.caster.target).toBe(fixed.uid);
  });

  it("keeps the target with the cursor off it, until a move or a click off any enemy", () => {
    const { player, fixed, tick, ticks, place } = setup();
    place(0, 2.4);
    tick(click(fixed.uid));
    ticks(10, hold(null));
    expect(player.caster.target).toBe(fixed.uid);

    tick(click(null));
    expect(player.caster.target).toBeNull();

    tick(click(fixed.uid));
    tick({ move: { x: 1, z: 0 } });
    expect(player.caster.target).toBeNull();
  });

  it("an enemy out of range waits: no walking up, it attacks once you get there", () => {
    const { player, fixed, total, tick, ticks, place } = setup();
    place(0, -2);
    tick(click(fixed.uid));
    ticks(60);
    expect(player.transform.position.z).toBe(-2);
    expect(total[fixed.uid]).toBe(0);
    expect(player.caster.target).toBe(fixed.uid);
  });

  it("holding A + click over an enemy moves left, attacks it when ready, and keeps moving", () => {
    const { player, fixed, total, tick, place } = setup();
    // East of the static dummy, walking west past it.
    place(3, 3);
    const left = { move: { x: -1, z: 0 }, ...hold(fixed.uid) };
    tick({ ...left, pressed: actions("primary") });
    let rootedTicks = 0;
    for (let i = 0; i < 90; i++) {
      tick(left);
      if (player.caster.cast) rootedTicks++;
    }
    expect(total[fixed.uid]).toBe(CAT_AA.damage);
    // It went on past the dummy, stopping only for the windup.
    expect(player.transform.position.x).toBeLessThan(-1.5);
    expect(rootedTicks).toBeLessThan(period() * CAT_AA.windupShare + 2);
  });

  it("hovering another enemy while holding switches the target", () => {
    const { player, fixed, patrol, tick, place } = setup();
    place(0, 2);
    tick(click(fixed.uid));
    tick(hold(patrol.uid));
    expect(player.caster.target).toBe(patrol.uid);
  });

  it("ability keys don't drop the target", () => {
    const { player, fixed, tick, place } = setup();
    place(0, 2.4);
    tick(click(fixed.uid));
    tick(click(null, "ability1"));
    expect(player.caster.target).toBe(fixed.uid);
  });
});

describe("auto attack, moba", () => {
  const command = (hover: number | null, at: { x: number; z: number }) => ({
    ...click(hover),
    moveCommand: at,
  });

  it("a right-click on an enemy chases it into range and attacks until the next order", () => {
    const { player, fixed, total, tick, ticks } = setup();
    // From the spawn, 9 m south of the static dummy.
    tick(command(fixed.uid, { x: 0, z: 3.5 }));
    expect(player.player.chase).toBe(true);
    // 8 m to close at 4 m/s.
    ticks(130);
    expect(gapTo(player, fixed)).toBeLessThanOrEqual(CAT_AA.range);
    expect(gapTo(player, fixed)).toBeGreaterThan(CAT_AA.range - 0.2);
    ticks(period() * 2);
    expect(total[fixed.uid]).toBeGreaterThanOrEqual(CAT_AA.damage * 2);

    // A right-click on the ground is a move order: no more attacks.
    tick(command(null, { x: 5, z: -5 }));
    expect(player.caster.target).toBeNull();
    expect(player.player.chase).toBe(false);
    expect(player.player.order).not.toBeNull();
  });

  it("chases the patrolling dummy as it walks", () => {
    const { patrol, total, tick, ticks } = setup();
    tick(command(patrol.uid, { x: 0, z: 0 }));
    ticks(600);
    expect(total[patrol.uid]).toBeGreaterThanOrEqual(CAT_AA.damage * 5);
  });

  it("stop drops the attack order", () => {
    const { player, fixed, tick } = setup();
    tick(command(fixed.uid, { x: 0, z: 3.5 }));
    tick({ pressed: actions("stop"), held: actions("stop") });
    expect(player.caster.target).toBeNull();
    expect(player.player.chase).toBe(false);
    expect(player.player.order).toBeNull();
  });
});
