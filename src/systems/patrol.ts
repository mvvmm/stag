import type { World } from "miniplex";
import { dmath } from "@/core/dmath";
import type { Entity } from "@/ecs/world";
import { DUMMY } from "@/systems/dummy";
import { movementStats } from "@/systems/movementStats";

/**
 * Walks patrols back and forth between their two ends through `locomotion`: full speed, braking on
 * the way in just in time (`√(2·decel·distance)`) to stop dead on the end (like the player's
 * click-to-move), a pause, then back.
 */
export function patrolSystem(world: World<Entity>, dt: number): void {
  for (const entity of world.with("transform", "mover", "patrol")) {
    const { transform, mover, patrol } = entity;
    const stats = movementStats(entity);
    const position = transform.position;
    mover.desired.x = 0;
    mover.desired.z = 0;
    if (patrol.wait > 0) {
      patrol.wait = Math.max(0, patrol.wait - dt);
      if (patrol.wait > 0) continue;
    }
    const target = patrol.towardB ? patrol.b : patrol.a;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = dmath.hypot(dx, dz);
    const want = Math.min(stats.speed, Math.sqrt(2 * stats.decel * distance));
    const speed = dmath.hypot(mover.velocity.x, mover.velocity.z);
    // Within this tick's travel (or there already): land on the end, stop, and turn back.
    if (distance <= Math.max(want, speed) * dt) {
      position.x = target.x;
      position.z = target.z;
      mover.velocity.x = 0;
      mover.velocity.z = 0;
      patrol.towardB = !patrol.towardB;
      patrol.wait = DUMMY.patrolPause;
      continue;
    }
    mover.desired.x = (dx / distance) * want;
    mover.desired.z = (dz / distance) * want;
  }
}
