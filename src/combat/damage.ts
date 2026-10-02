import type { World } from "miniplex";
import type { Entity, Health } from "@/ecs/world";

/**
 * Takes `amount` off a target's health (never below 0: nothing dies yet) and records the hit in
 * `health.taken` for this tick, so the view pops a damage number. Zero or less does nothing.
 */
export function applyDamage(target: { health: Health }, amount: number): void {
  if (!(amount > 0)) return;
  const health = target.health;
  health.current = Math.max(0, health.current - amount);
  health.taken.push(amount);
}

/** Forgets last tick's hits. Runs at the start of every tick, with the transform snapshot. */
export function clearDamageTaken(world: World<Entity>): void {
  for (const { health } of world.with("health")) {
    if (health.taken.length > 0) health.taken.length = 0;
  }
}
