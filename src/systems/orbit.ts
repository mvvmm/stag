import type { World } from "miniplex";
import { defineTunables } from "@/core/tuning";
import type { Entity } from "@/ecs/world";

export const ORBIT = defineTunables("orbit", {
  /** Multiplies every orbit's angular speed. */
  speedScale: { value: 1, min: 0, max: 4, step: 0.05 },
});

/** Advances orbiting entities around their center and faces them along their direction of travel. */
export function orbitSystem(world: World<Entity>, dt: number): void {
  for (const { transform, orbit } of world.with("transform", "orbit")) {
    orbit.angle += orbit.speed * ORBIT.speedScale * dt;
    transform.position.x = orbit.center.x + Math.cos(orbit.angle) * orbit.radius;
    transform.position.y = orbit.center.y;
    transform.position.z = orbit.center.z + Math.sin(orbit.angle) * orbit.radius;
    transform.rotation.y = -orbit.angle;
  }
}
