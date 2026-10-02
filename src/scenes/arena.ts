import type { World } from "miniplex";
import { DUMMY_HURTBOX, type DummySpawn } from "@/data/dummies";
import { greyboxRoom } from "@/data/rooms/greybox";
import { gymRoom } from "@/data/rooms/gym";
import type { Room } from "@/data/rooms/room";
import { yardRoom } from "@/data/rooms/yard";
import { cloneTransform, type Entity } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { DUMMY, dummySystem } from "@/systems/dummy";
import { locomotionSystem } from "@/systems/locomotion";
import { patrolSystem } from "@/systems/patrol";
import { playerControlSystem } from "@/systems/playerControl";

// Room scenes: a hand-built room plus the player (and its training dummies, if it has any). The simulation half; the view (floor, obstacle
// meshes, player, camera follow, occluder fading) is in `arena.view.ts`.

/** A scene that plays `room`: the player walks it with pathing and collision. */
export function roomSim(id: string, label: string, room: Room): SceneSim {
  return {
    id,
    label,
    systems: [
      { name: "playerControl", run: playerControlSystem },
      ...(room.dummies?.length
        ? [
            { name: "patrol", run: patrolSystem },
            { name: "dummy", run: dummySystem },
          ]
        : []),
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
/** Dummies to try abilities on. */
export const yardSim = roomSim("yard", "Training yard", yardRoom);

/**
 * Fills the world with a room (one `room` entity plus an `obstacle` per obstacle), its dummies and
 * the player.
 */
export function spawnRoom(world: World<Entity>, room: Room): void {
  world.add({ room: { id: room.id, width: room.width, depth: room.depth } });
  for (const obstacle of room.obstacles) world.add({ obstacle: structuredClone(obstacle) });

  for (const spawn of room.dummies ?? []) spawnDummy(world, spawn);

  const transform = {
    position: { x: room.spawn.x, y: 0, z: room.spawn.z },
    rotation: { x: 0, y: 0, z: 0 },
  };
  world.add({
    transform,
    prevTransform: cloneTransform(transform),
    mover: { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 }, turnSide: 1 },
    player: { order: null, orders: 0, click: null },
    solid: true,
  });
}

/** A training dummy at full health, solid like every body. */
function spawnDummy(world: World<Entity>, spawn: DummySpawn): void {
  const at = spawn.kind === "static" ? spawn.at : spawn.a;
  const facing = spawn.kind === "static" ? (spawn.facing ?? 0) : 0;
  const transform = { position: { x: at.x, y: 0, z: at.z }, rotation: { x: 0, y: facing, z: 0 } };
  const max = DUMMY.maxHealth;
  const dummy: Entity = {
    transform,
    prevTransform: cloneTransform(transform),
    health: { current: max, max, taken: [] },
    hurtbox: { ...DUMMY_HURTBOX },
    dummy: { kind: spawn.kind, sinceHit: 0, lastHealth: max },
    solid: true,
  };
  if (spawn.kind === "patrol") {
    dummy.mover = { velocity: { x: 0, z: 0 }, desired: { x: 0, z: 0 }, turnSide: 1 };
    dummy.patrol = { a: { ...spawn.a }, b: { ...spawn.b }, towardB: true, wait: 0 };
  }
  world.add(dummy);
}
