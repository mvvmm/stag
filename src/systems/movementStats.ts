import { defineTunables } from "@/core/tuning";
import { DUMMY_RADIUS } from "@/data/dummies";
import type { Entity } from "@/ecs/world";
import { DUMMY } from "@/systems/dummy";

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
  /** Movement and pathing radius, m: one circle whatever the body's shape (like League's pathing
   * radius), so every path fits the body that follows it and the facing turns freely. */
  radius: { value: 0.4, min: 0.1, max: 0.8, step: 0.01 },
  /** The body's own shape, for hits (2.1): half its width, m. */
  bodyRadius: { value: 0.28, min: 0.1, max: 0.8, step: 0.01 },
  /** The body's length nose to rump, m: a pill along the facing (at most 2 × `bodyRadius`, a
   * circle). */
  bodyLength: { value: 1.9, min: 0, max: 4, step: 0.05 },
});

export type MovementStats = {
  speed: number;
  accel: number;
  decel: number;
  turnAccel: number;
  /** Radians per second. */
  turnRate: number;
  /** Movement and pathing radius, m. */
  radius: number;
};

/**
 * An entity's movement numbers this tick. The one place movement reads them, so per-form data
 * (10.1) and speed modifiers like sprint or slows (4.1) slot in here.
 */
export function movementStats(entity: Entity): MovementStats {
  if (entity.dummy) {
    return {
      speed: DUMMY.patrolSpeed,
      accel: DUMMY.patrolAccel,
      decel: DUMMY.patrolAccel,
      turnAccel: DUMMY.patrolAccel,
      turnRate: (DUMMY.turnRate * Math.PI) / 180,
      radius: DUMMY_RADIUS,
    };
  }
  return {
    speed: PLAYER.speed,
    accel: PLAYER.accel,
    decel: PLAYER.decel,
    turnAccel: PLAYER.turnAccel,
    turnRate: (PLAYER.turnRate * Math.PI) / 180,
    radius: PLAYER.radius,
  };
}
