import { defineTunables } from "@/core/tuning";
import type { Entity } from "@/ecs/world";

/** The player's movement feel. Per-form movement data replaces these in 10.1. */
export const PLAYER = defineTunables("player", {
  /** Top speed, m/s. */
  speed: { value: 4, min: 0, max: 20, step: 0.1 },
  /** Speeding up and steering, m/s². */
  accel: { value: 60, min: 1, max: 1000, step: 1 },
  /** Braking with no input, and for arrival, m/s². */
  decel: { value: 80, min: 1, max: 1000, step: 1 },
  /** Steering when the wanted direction points more than 90° away from the velocity, m/s². */
  turnAccel: { value: 90, min: 1, max: 1000, step: 1 },
  /** How fast the facing turns toward the movement direction, degrees per second. */
  turnRate: { value: 1800, min: 90, max: 3600, step: 10 },
  /** Footprint half-width, m (collision and pathing). */
  radius: { value: 0.28, min: 0.1, max: 0.8, step: 0.01 },
  /** Footprint length, nose to tail end, m: a pill along the facing (the Cat's long body). At most
   * 2 × radius it's a circle. */
  length: { value: 1.9, min: 0, max: 4, step: 0.05 },
});

export type MovementStats = {
  speed: number;
  accel: number;
  decel: number;
  turnAccel: number;
  /** Radians per second. */
  turnRate: number;
  /** Footprint half-width, m. */
  radius: number;
  /** Footprint length, m (at most 2 × radius: a circle). */
  length: number;
};

/**
 * An entity's movement numbers this tick. The one place movement reads them, so per-form data
 * (10.1) and speed modifiers like sprint or slows (4.1) slot in here.
 */
export function movementStats(_entity: Entity): MovementStats {
  return {
    speed: PLAYER.speed,
    accel: PLAYER.accel,
    decel: PLAYER.decel,
    turnAccel: PLAYER.turnAccel,
    turnRate: (PLAYER.turnRate * Math.PI) / 180,
    radius: PLAYER.radius,
    length: PLAYER.length,
  };
}
