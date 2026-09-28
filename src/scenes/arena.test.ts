import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { greyboxRoom } from "@/data/rooms/greybox";
import { createWorld } from "@/ecs/world";
import { arenaSim } from "@/scenes/arena";

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
});
