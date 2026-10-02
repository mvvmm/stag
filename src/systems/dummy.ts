import type { World } from "miniplex";
import { defineTunables } from "@/core/tuning";
import type { Entity } from "@/ecs/world";

/** Training dummies (the Training yard). */
export const DUMMY = defineTunables("dummy", {
  maxHealth: { value: 1000, min: 1, max: 100000, step: 1 },
  /** Seconds without a hit before a dummy refills to full. */
  refillDelay: { value: 3, min: 0, max: 30, step: 0.1 },
  /** The patrolling dummy's top speed, m/s. */
  patrolSpeed: { value: 2, min: 0, max: 10, step: 0.1 },
  /** Its speeding up and braking, m/s². */
  patrolAccel: { value: 12, min: 1, max: 200, step: 1 },
  /** Seconds it stands at each end of its route. */
  patrolPause: { value: 0.4, min: 0, max: 5, step: 0.05 },
  /** How fast it turns to face where it walks, degrees per second. */
  turnRate: { value: 540, min: 30, max: 3600, step: 10 },
  /** Its collision circle, m: tiny, so you know it's there without having to think about it
   * (hits use the much bigger hurtbox). Enemies get the same. */
  radius: { value: 0.15, min: 0.02, max: 0.8, step: 0.01 },
});

/**
 * Keeps dummies alive: any drop in health (a hit, or an edit in the entity pane) restarts the
 * timer, and after `refillDelay` seconds without one the dummy is back to full. The maximum
 * follows the `dummy.maxHealth` tunable.
 */
export function dummySystem(world: World<Entity>, dt: number): void {
  for (const { dummy, health } of world.with("dummy", "health")) {
    health.max = DUMMY.maxHealth;
    if (health.current > health.max) health.current = health.max;
    if (health.current < dummy.lastHealth) dummy.sinceHit = 0;
    else dummy.sinceHit += dt;
    if (health.current < health.max && dummy.sinceHit >= DUMMY.refillDelay) {
      health.current = health.max;
    }
    dummy.lastHealth = health.current;
  }
}
