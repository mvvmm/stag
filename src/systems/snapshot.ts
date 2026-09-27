import type { World } from "miniplex";
import { copyTransform, type Entity } from "@/ecs/world";

/** Runs first every tick: remembers where interpolated entities were before this tick moves them. */
export function snapshotSystem(world: World<Entity>): void {
  for (const { transform, prevTransform } of world.with("transform", "prevTransform")) {
    copyTransform(transform, prevTransform);
  }
}
