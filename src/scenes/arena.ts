import type { World } from "miniplex";
import { greyboxRoom } from "@/data/rooms/greybox";
import type { Room } from "@/data/rooms/room";
import { cloneTransform, type Entity } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { pawnSystem } from "@/systems/pawn";

// The arena: a hand-built room plus the player. The simulation half; the view (floor, obstacle
// meshes, camera follow, occluder fading) is in `arena.view.ts`. Until 1.2 the player is the
// throwaway demo pawn, which walks through walls until collision (1.3).

export const arenaSim: SceneSim = {
  id: "arena",
  label: "Arena (grey-box)",
  systems: [{ name: "pawn", run: pawnSystem }],
  spawn(world) {
    spawnRoom(world, greyboxRoom);
  },
};

/** Fills the world with a room (one `room` entity plus an `obstacle` per obstacle) and the pawn. */
export function spawnRoom(world: World<Entity>, room: Room): void {
  world.add({ room: { id: room.id, width: room.width, depth: room.depth } });
  for (const obstacle of room.obstacles) world.add({ obstacle: structuredClone(obstacle) });

  const transform = {
    position: { x: room.spawn.x, y: 0.3, z: room.spawn.z },
    rotation: { x: 0, y: 0, z: 0 },
  };
  world.add({ transform, prevTransform: cloneTransform(transform), pawn: { target: null } });
}
