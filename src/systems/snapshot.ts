import type { World } from "miniplex";
import { clearDamageTaken } from "@/combat/damage";
import { copyTransform, type Entity } from "@/ecs/world";

/**
 * Runs first every tick: remembers where interpolated entities were before this tick moves them,
 * and forgets last tick's hits.
 */
export function snapshotSystem(world: World<Entity>): void {
  for (const { transform, prevTransform } of world.with("transform", "prevTransform")) {
    copyTransform(transform, prevTransform);
  }
  clearDamageTaken(world);
}
