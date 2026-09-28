import { afterEach, describe, expect, it } from "vitest";
import type { Vec2 } from "@/core/math";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { greyboxRoom } from "@/data/rooms/greybox";
import { distanceToShape } from "@/data/rooms/room";
import { createWorld } from "@/ecs/world";
import { type Action, emptyInputFrame, type InputFrame } from "@/input/actions";
import { spawnRoom } from "@/scenes/arena";
import { locomotionSystem } from "@/systems/locomotion";
import { PLAYER } from "@/systems/movementStats";
import { playerControlSystem } from "@/systems/playerControl";

const DT = 1 / 60;

function setup(at: Vec2 = greyboxRoom.spawn) {
  const world = createWorld();
  spawnRoom(world, greyboxRoom);
  const entity = world.with("player", "mover", "transform").first;
  if (!entity) throw new Error("no player");
  entity.transform.position.x = at.x;
  entity.transform.position.z = at.z;
  const rng = createRng(1);
  const tick = (input: Partial<InputFrame> = {}) => {
    const frame = { ...emptyInputFrame(), ...input };
    playerControlSystem(world, DT, rng, frame);
    locomotionSystem(world, DT, rng, frame);
  };
  return { entity, player: entity.player, mover: entity.mover, tick };
}

const press = (action: Action) => ({ pressed: new Set([action]), held: new Set([action]) });
const position = (e: { transform: { position: Vec2 } }) => ({
  x: e.transform.position.x,
  z: e.transform.position.z,
});

afterEach(() => tuning.reset());

describe("playerControl", () => {
  it("WASD asks for move · speed and drops the order", () => {
    const { player, mover, tick } = setup();
    tick({ moveCommand: { x: 5, z: -3 } });
    expect(player.order).not.toBeNull();
    tick({ move: { x: 0.6, z: 0.8 } });
    expect(player.order).toBeNull();
    expect(mover.desired.x).toBeCloseTo(0.6 * PLAYER.speed, 12);
    expect(mover.desired.z).toBeCloseTo(0.8 * PLAYER.speed, 12);
  });

  it("stop drops the order and brakes", () => {
    const { player, mover, tick } = setup();
    tick({ moveCommand: { x: 5, z: -3 } });
    for (let i = 0; i < 10; i++) tick();
    tick(press("stop"));
    expect(player.order).toBeNull();
    expect(mover.desired).toEqual({ x: 0, z: 0 });
  });

  it("counts new clicks, not ticks the button is held", () => {
    const { player, tick } = setup();
    tick({ moveCommand: { x: 5, z: -3 } });
    tick({ moveCommand: { x: 5, z: -3 } });
    tick({ moveCommand: { x: 5.5, z: -3 } });
    expect(player.orders).toBe(1);
    tick();
    tick({ moveCommand: { x: -5, z: -3 } });
    expect(player.orders).toBe(2);
  });

  it("repaths while held only when the cursor changes nav cell", () => {
    const { player, tick } = setup({ x: 4.5, z: 0.5 });
    tick({ moveCommand: { x: 4.5, z: 6 } }); // behind the pillar: a path with corners
    const waypoints = player.order?.waypoints;
    expect(waypoints?.length).toBeGreaterThan(1);
    tick({ moveCommand: { x: 4.52, z: 6.01 } }); // same 0.25 m cell
    expect(player.order?.waypoints).toBe(waypoints);
    expect(player.order?.goal).toEqual({ x: 4.52, z: 6.01 });
    expect(player.order?.waypoints.at(-1)).toEqual({ x: 4.52, z: 6.01 });
    tick({ moveCommand: { x: -6, z: 0 } });
    expect(player.order?.waypoints).not.toBe(waypoints);
  });

  it("does nothing new while the button is held still on the spot it reached", () => {
    const { entity, player, tick } = setup();
    const click = { x: 1, z: -1 };
    for (let i = 0; i < 120; i++) tick({ moveCommand: click });
    expect(player.order).toBeNull();
    expect(position(entity)).toEqual(click);
    expect(player.orders).toBe(1);
  });

  for (const [speed, decel] of [
    [7, 175],
    [3, 30],
    [15, 1000],
    [20, 1],
  ] as const) {
    it(`lands exactly on the goal without overshooting (speed ${speed}, decel ${decel})`, () => {
      tuning.set("player.speed", speed);
      tuning.set("player.decel", decel);
      const { entity, player, mover, tick } = setup({ x: -6, z: -1 });
      const goal = { x: 1.5, z: -2.5 };
      tick({ moveCommand: goal });
      let remaining = Infinity;
      for (let i = 0; i < 600 && player.order; i++) {
        const p = position(entity);
        const d = Math.hypot(goal.x - p.x, goal.z - p.z);
        expect(d).toBeLessThanOrEqual(remaining + 1e-12);
        remaining = d;
        tick();
      }
      expect(player.order).toBeNull();
      expect(position(entity)).toEqual(goal);
      expect(mover.velocity).toEqual({ x: 0, z: 0 });
    });
  }

  it("walks around a pillar to a click behind it", () => {
    const { entity, player, tick } = setup({ x: 4.5, z: 0.5 });
    const goal = { x: 4.5, z: 6.5 };
    tick({ moveCommand: goal });
    let clearance = Infinity;
    for (let i = 0; i < 300 && player.order; i++) {
      tick();
      for (const { shape } of greyboxRoom.obstacles) {
        clearance = Math.min(clearance, distanceToShape(position(entity), shape));
      }
    }
    expect(position(entity)).toEqual(goal);
    // Steering arcs may cut a corner a little before collision (1.3) exists.
    expect(clearance).toBeGreaterThan(PLAYER.radius - 0.1);
  });

  it("stops outside an obstacle when clicked into it", () => {
    const { entity, player, tick } = setup();
    tick({ moveCommand: { x: 4.5, z: 3.4 } }); // the big pillar
    for (let i = 0; i < 300 && player.order; i++) tick();
    const pillar = { kind: "circle", x: 4.5, z: 3.5, r: 0.9 } as const;
    expect(distanceToShape(position(entity), pillar)).toBeGreaterThanOrEqual(PLAYER.radius);
  });
});
