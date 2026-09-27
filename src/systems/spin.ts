import type { World } from "miniplex";
import type { Entity } from "@/ecs/world";

export function spinSystem(world: World<Entity>, dt: number): void {
  for (const { transform, spin } of world.with("transform", "spin")) {
    transform.rotation.y += spin.speed * dt;
  }
}
