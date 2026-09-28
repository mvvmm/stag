import type { World } from "miniplex";
import { greyboxRoom } from "@/data/rooms/greybox";
import type { Room } from "@/data/rooms/room";
import { cloneTransform, type Entity } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { locomotionSystem } from "@/systems/locomotion";
import { playerControlSystem } from "@/systems/playerControl";

// The arena: a hand-built room plus the player. The simulation half; the view (floor, obstacle
// meshes, player, camera follow, occluder fading) is in `arena.view.ts`. The player walks through
// walls with WASD until collision (1.3); click-to-move already paths around them.

export const arenaSim: SceneSim = {
  id: "arena",
  label: "Arena (grey-box)",
  systems: [
    { name: "playerControl", run: playerControlSystem },
    { name: "locomotion", run: locomotionSystem },
  ],
  spawn(world) {
    spawnRoom(world, greyboxRoom);
  },
};

/** Fills the world with a room (one `room` entity plus an `obstacle` per obstacle) and the player. */
export function spawnRoom(world: World<Entity>, room: Room): void {
  world.add({ room: { id: room.id, width: room.width, depth: room.depth } });
  for (const obstacle of room.obstacles) world.add({ obstacle: structuredClone(obstacle) });

  const transform = {
    position: { x: room.spawn.x, y: 0, z: room.spawn.z },
    rotation: { x: 0, y: 0, z: 0 },
  };
  world.add({
    transform,
    prevTransform: cloneTransform(transform),
    mover: { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 } },
    player: { order: null, orders: 0, click: null },
  });
}
