import type { World } from "miniplex";
import { footprintCircles } from "@/collision/body";
import { bodyFits, clipVelocity, fitBody, moveAndSlide, type SlideResult } from "@/collision/slide";
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
 * them (unless the entity has `noclip`), and the facing turns toward the direction it actually
 * moved (along a wall it slides on) at `turnRate`. Landing exactly on the desired velocity means stops don't drift. The velocity loses
 * its part into any surface it ends up touching, so sliding carries the projected speed. A long
 * footprint (a pill along the facing) swings its ends when it turns, so it only turns as far as it
 * fits; a blocked one may push itself clear to turn (see below).
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
    const start = { x: position.x, z: position.z };
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

    // Moving, the facing follows where the body actually went (along a wall it slides on), not
    // where it's pushing: turning toward the wall would swing a long body's nose into it. Blocked
    // (it wants to go somewhere but didn't move), it turns toward where it wants to go, and a long
    // body may push itself clear to make that turn: that's how it wiggles out of a corner its nose
    // is caught in.
    const moved = { x: (position.x - start.x) / dt, z: (position.z - start.z) / dt };
    const speed = dmath.hypot(v.x, v.z);
    const blocked =
      dmath.hypot(moved.x, moved.z) <= FACE_MIN_SPEED && dmath.hypot(desired.x, desired.z) > 0;
    const toward = blocked ? desired : moved;
    if (blocked || dmath.hypot(moved.x, moved.z) > FACE_MIN_SPEED) {
      const turn = wrapAngle(dmath.atan2(toward.x, toward.z) - transform.rotation.y);
      const most = stats.turnRate * dt;
      const step = Math.min(most, Math.max(-most, turn));
      if (entity.noclip || footprintCircles(stats, 0).length === 1) {
        transform.rotation.y = wrapAngle(transform.rotation.y + step);
      } else {
        turnFitting(shapes, position, transform.rotation, stats, step, blocked);
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
 * Turns a long body by `step` as far as it fits: the full turn, else half, else a quarter, else
 * none. Only a blocked body (`push`) may be pushed clear to make the turn: pushing a moving body off
 * a wall it slides along would let it drift back and turn into the wall again every few ticks.
 */
function turnFitting(
  shapes: readonly ObstacleShape[],
  position: Vec2,
  rotation: { y: number },
  footprint: { radius: number; length: number },
  step: number,
  push: boolean,
): void {
  for (const tried of [step, step / 2, step / 4]) {
    const yaw = wrapAngle(rotation.y + tried);
    const circles = footprintCircles(footprint, yaw);
    if (!push) {
      if (!bodyFits(shapes, position, footprint.radius, circles)) continue;
    } else {
      const fit = fitBody(shapes, position, footprint.radius, circles);
      if (!fit.fits) continue;
      position.x = fit.position.x;
      position.z = fit.position.z;
    }
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
