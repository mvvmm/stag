import type { World } from "miniplex";
import type { Entity } from "@/ecs/world";

/** Advances orbiting entities around their center and faces them along their direction of travel. */
export function orbitSystem(world: World<Entity>, dt: number): void {
  for (const { transform, orbit } of world.with("transform", "orbit")) {
    orbit.angle += orbit.speed * dt;
    transform.position.x = orbit.center.x + Math.cos(orbit.angle) * orbit.radius;
    transform.position.y = orbit.center.y;
    transform.position.z = orbit.center.z + Math.sin(orbit.angle) * orbit.radius;
    transform.rotation.y = -orbit.angle;
  }
}
