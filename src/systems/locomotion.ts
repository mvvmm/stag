import type { World } from "miniplex";
import { footprintCircles } from "@/collision/body";
import { clipVelocity, fitBody, moveAndSlide, type SlideResult } from "@/collision/slide";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import { type Vec2, wrapAngle } from "@/core/math";
import type { Rng } from "@/core/rng";
import type { ObstacleShape } from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { movementStats } from "@/systems/movementStats";

/** Below this speed (m/s) the facing holds instead of following the velocity. */
const FACE_MIN_SPEED = 0.1;
/** Seconds the motion trail stays on the ground. */
const TRAIL_SECONDS = 2;
const ORANGE = { r: 1, g: 0.6, b: 0.2 };

/**
 * Kinematic movement for every `mover`: the velocity moves toward `desired` at a linear rate
 * (`decel` when asked to stop, `turnAccel` when asked to go against the current velocity, `accel`
 * otherwise), the position follows the new velocity, sliding along obstacles instead of entering
 * them (unless the entity has `noclip`), and the facing turns toward the movement direction at
 * `turnRate`. Landing exactly on the desired velocity means stops don't drift. The velocity loses
 * its part into any surface it ends up touching, so sliding carries the projected speed. A long
 * footprint (a pill along the facing) swings its ends when it turns: a wall they swing into pushes
 * the body aside, and where it can't make room (caught between obstacles) it turns only halfway, or
 * not at all.
 */
export function locomotionSystem(world: World<Entity>, dt: number, _rng: Rng, _input: InputFrame) {
  const shapes: ObstacleShape[] = [];
  for (const { obstacle } of world.with("obstacle")) shapes.push(obstacle.shape);
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
    const motion = { x: v.x * dt, z: v.z * dt };
    if (entity.noclip) {
      position.x += motion.x;
      position.z += motion.z;
    } else {
      const from = { x: position.x, z: position.z };
      const circles = footprintCircles(stats, transform.rotation.y);
      const slide = moveAndSlide(shapes, from, motion, stats.radius, circles);
      position.x = slide.position.x;
      position.z = slide.position.z;
      clipVelocity(v, slide.touching);
      if (debugDraw.enabled) drawSlide(from, motion, slide, stats.radius);
    }

    const speed = dmath.hypot(v.x, v.z);
    if (speed > FACE_MIN_SPEED) {
      const turn = wrapAngle(dmath.atan2(v.x, v.z) - transform.rotation.y);
      const most = stats.turnRate * dt;
      const step = Math.min(most, Math.max(-most, turn));
      if (entity.noclip || footprintCircles(stats, 0).length === 1) {
        transform.rotation.y = wrapAngle(transform.rotation.y + step);
      } else {
        turnFitting(shapes, position, transform.rotation, stats, step);
      }
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

/**
 * Turns a long body by `step` if it fits: the full turn, else half of it, else none. A turn that
 * swings an end into an obstacle pushes the body clear (`fitBody`).
 */
function turnFitting(
  shapes: readonly ObstacleShape[],
  position: Vec2 & { y?: number },
  rotation: { y: number },
  footprint: { radius: number; length: number },
  step: number,
): void {
  for (const tried of [step, step / 2]) {
    const yaw = wrapAngle(rotation.y + tried);
    const fit = fitBody(shapes, position, footprint.radius, footprintCircles(footprint, yaw));
    if (!fit.fits) continue;
    position.x = fit.position.x;
    position.z = fit.position.z;
    rotation.y = yaw;
    return;
  }
}

/** The `collision` debug category: contacts and their normals, the slide, and safety-net fixes. */
function drawSlide(from: Vec2, wanted: Vec2, slide: SlideResult, radius: number): void {
  const style = { color: ORANGE, category: "collision" };
  for (const { point, normal } of slide.contacts) {
    debugDraw.point(point, style);
    debugDraw.arrow(point, { x: point.x + normal.x * 0.4, z: point.z + normal.z * 0.4 }, style);
  }
  if (slide.contacts.length > 0) {
    debugDraw.line(
      from,
      { x: from.x + wanted.x, z: from.z + wanted.z },
      { ...style, color: "grey" },
    );
    debugDraw.line(from, slide.position, style);
  }
  if (slide.depenetrated) {
    debugDraw.circle(slide.position, radius + 0.1, {
      color: "red",
      category: "collision",
      duration: 0.5,
    });
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
