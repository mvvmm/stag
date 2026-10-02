import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { DUMMY_RADIUS } from "@/data/dummies";
import { greyboxRoom } from "@/data/rooms/greybox";
import { yardRoom } from "@/data/rooms/yard";
import { createWorld } from "@/ecs/world";
import { emptyInputFrame } from "@/input/actions";
import { arenaSim, yardSim } from "@/scenes/arena";
import { PLAYER } from "@/systems/movementStats";
import { createSimulation } from "@/systems/simulation";

describe("arena spawn", () => {
  it("turns the room into a room entity, one obstacle entity each, and the player at the spawn", () => {
    const world = createWorld();
    arenaSim.spawn(world, createRng(1));

    const rooms = [...world.with("room")];
    expect(rooms.map((e) => e.room)).toEqual([{ id: "greybox", width: 30, depth: 20 }]);

    const obstacles = [...world.with("obstacle")];
    expect(obstacles.map((e) => e.obstacle)).toEqual(greyboxRoom.obstacles);
    expect(obstacles.every((e) => e.transform === undefined)).toBe(true);
    // Copies, so editing an entity never changes the room data.
    expect(obstacles[0]?.obstacle).not.toBe(greyboxRoom.obstacles[0]);

    const players = [...world.with("player", "mover", "transform")];
    expect(players).toHaveLength(1);
    expect(players[0]?.transform.position).toEqual({ ...greyboxRoom.spawn, y: 0 });
    expect(players[0]?.mover.velocity).toEqual({ x: 0, z: 0 });
    expect(players[0]?.player).toEqual({ order: null, orders: 0, click: null });
  });

  it("spawns the same world regardless of the seed", () => {
    const a = createWorld();
    const b = createWorld();
    arenaSim.spawn(a, createRng(1));
    arenaSim.spawn(b, createRng(2));
    expect(b.entities).toEqual(a.entities);
  });

  it("spawns the yard's dummies at full health; the static one is also an obstacle", () => {
    const world = createWorld();
    yardSim.spawn(world, createRng(1));
    const dummies = [...world.with("dummy", "health", "hurtbox", "transform")];
    expect(dummies.map((e) => e.dummy.kind)).toEqual(["static", "patrol"]);
    for (const { health } of dummies) expect(health.current).toBe(health.max);
    const [still, walker] = dummies;
    expect(still?.obstacle?.type).toBe("dummy");
    expect(still?.mover).toBeUndefined();
    expect(walker?.obstacle).toBeUndefined();
    expect(walker?.patrol?.a).toEqual(
      yardRoom.dummies?.[1]?.kind === "patrol" && yardRoom.dummies[1].a,
    );
  });

  it("the static dummy blocks the player like a pillar", () => {
    const world = createWorld();
    const rng = createRng(1);
    yardSim.spawn(world, rng);
    const simulation = createSimulation(world, rng, yardSim.systems);
    const player = world.with("player", "transform").first;
    const still = world.with("dummy", "obstacle", "transform").first;
    if (!player || !still) throw new Error("no player or static dummy");
    // The spawn is due south of it: walk north into it for 5 s.
    const input = { ...emptyInputFrame(), move: { x: 0, z: 1 } };
    for (let t = 0; t < 300; t++) simulation.step(1 / 60, input);
    const { x, z } = player.transform.position;
    expect(x).toBeCloseTo(still.transform.position.x, 6);
    const gap = still.transform.position.z - z;
    expect(gap).toBeGreaterThanOrEqual(DUMMY_RADIUS + PLAYER.radius - 1e-6);
    expect(gap).toBeLessThan(DUMMY_RADIUS + PLAYER.radius + 0.05);
  });
});
