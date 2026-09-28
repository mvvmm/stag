import type { World } from "miniplex";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import { type Vec2, wrapAngle } from "@/core/math";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { movementStats } from "@/systems/movementStats";

/** Below this speed (m/s) the facing holds instead of following the velocity. */
const FACE_MIN_SPEED = 0.1;
/** Seconds the motion trail stays on the ground. */
const TRAIL_SECONDS = 2;

/**
 * Kinematic movement for every `mover`: the velocity moves toward `desired` at a linear rate
 * (`decel` when asked to stop, `turnAccel` when asked to go against the current velocity, `accel`
 * otherwise), the position follows the new velocity, and the facing turns toward the movement
 * direction at `turnRate`. Landing exactly on the desired velocity means stops don't drift.
 */
export function locomotionSystem(world: World<Entity>, dt: number, _rng: Rng, _input: InputFrame) {
  for (const entity of world.with("transform", "mover")) {
    const { transform, mover } = entity;
    const stats = movementStats(entity);
    const v = mover.velocity;
    const desired = mover.desired;

    const stopping = desired.x === 0 && desired.z === 0;
    const against = v.x * desired.x + v.z * desired.z < 0;
    const rate = stopping ? stats.decel : against ? stats.turnAccel : stats.accel;
    moveToward(v, desired, rate * dt);

    const position = transform.position;
    position.x += v.x * dt;
    position.z += v.z * dt;

    const speed = dmath.hypot(v.x, v.z);
    if (speed > FACE_MIN_SPEED) {
      const turn = wrapAngle(dmath.atan2(v.x, v.z) - transform.rotation.y);
      const most = stats.turnRate * dt;
      transform.rotation.y = wrapAngle(
        transform.rotation.y + Math.min(most, Math.max(-most, turn)),
      );
    }

    if (!debugDraw.enabled) continue;
    const at = { x: position.x, z: position.z };
    const scale = 0.25; // arrow length per m/s
    debugDraw.arrow(
      at,
      { x: at.x + v.x * scale, z: at.z + v.z * scale },
      {
        color: "yellow",
        category: "movement",
      },
    );
    debugDraw.arrow(
      at,
      { x: at.x + desired.x * scale, z: at.z + desired.z * scale },
      {
        color: "cyan",
        category: "movement",
      },
    );
    const facing = transform.rotation.y;
    debugDraw.line(
      { x: at.x + dmath.sin(facing) * 0.5, z: at.z + dmath.cos(facing) * 0.5 },
      { x: at.x + dmath.sin(facing) * 0.9, z: at.z + dmath.cos(facing) * 0.9 },
      { color: "white", category: "movement" },
    );
    if (speed > 0) {
      debugDraw.point(at, { color: "blue", category: "trail", duration: TRAIL_SECONDS });
    }
  }
}

/** Moves `v` toward `target` by at most `step`, landing on it exactly when it's within reach. */
export function moveToward(v: Vec2, target: Vec2, step: number): void {
  const dx = target.x - v.x;
  const dz = target.z - v.z;
  const distance = dmath.hypot(dx, dz);
  if (distance <= step) {
    v.x = target.x;
    v.z = target.z;
  } else {
    v.x += (dx / distance) * step;
    v.z += (dz / distance) * step;
  }
}
