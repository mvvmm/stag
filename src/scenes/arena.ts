import type { World } from "miniplex";
import { greyboxRoom } from "@/data/rooms/greybox";
import { gymRoom } from "@/data/rooms/gym";
import type { Room } from "@/data/rooms/room";
import { cloneTransform, type Entity } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { locomotionSystem } from "@/systems/locomotion";
import { playerControlSystem } from "@/systems/playerControl";

// Room scenes: a hand-built room plus the player. The simulation half; the view (floor, obstacle
// meshes, player, camera follow, occluder fading) is in `arena.view.ts`.

/** A scene that plays `room`: the player walks it with pathing and collision. */
export function roomSim(id: string, label: string, room: Room): SceneSim {
  return {
    id,
    label,
    systems: [
      { name: "playerControl", run: playerControlSystem },
      { name: "locomotion", run: locomotionSystem },
    ],
    spawn(world) {
      spawnRoom(world, room);
    },
  };
}

/** The grey-box combat room (the default scene). */
export const arenaSim = roomSim("arena", "Arena (grey-box)", greyboxRoom);
/** The collision test bench. */
export const gymSim = roomSim("gym", "Collision gym", gymRoom);

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
    mover: { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 }, turnSide: 1 },
    player: { order: null, orders: 0, click: null },
  });
}
