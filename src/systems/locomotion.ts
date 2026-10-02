import type { World } from "miniplex";
import { clipVelocity, moveAndSlide, type SlideResult } from "@/collision/slide";
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
/** A turn within this of 180° (radians) is a reversal: it swings back through the side the body
 * came from instead of taking whichever arc is a hair shorter. */
const REVERSE_BAND = (10 * Math.PI) / 180;
/** Seconds the motion trail stays on the ground. */
const TRAIL_SECONDS = 2;
const ORANGE = { r: 1, g: 0.6, b: 0.2 };

/**
 * Kinematic movement for every `mover`: the velocity moves toward `desired` at a linear rate
 * (`decel` when asked to stop, `turnAccel` when asked to go against the current velocity, `accel`
 * otherwise), the position follows the new velocity, sliding along obstacles, and for a `solid`
 * mover other solid bodies, instead of entering them (unless the entity has `noclip`), and the facing turns toward the direction it actually
 * moved (along a wall it slides on), or toward where it wants to go when blocked, at `turnRate`; a
 * reversal turns back through the side it came from (`turnSide`). Landing exactly on the desired
 * velocity means stops don't drift. The velocity loses its part into any surface it ends up
 * touching, so sliding carries the projected speed.
 */
export function locomotionSystem(world: World<Entity>, dt: number, _rng: Rng, _input: InputFrame) {
  const statics: ObstacleShape[] = [];
  for (const { obstacle } of world.with("obstacle")) statics.push(obstacle.shape);
  const solids = world.with("transform", "solid").without("noclip");
  for (const entity of world.with("transform", "mover")) {
    const { transform, mover } = entity;
    const stats = movementStats(entity);
    // Every other solid body blocks it too, as a circle where it stands right now.
    const shapes = entity.solid ? withBodies(statics, solids, entity) : statics;
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
      const slide = moveAndSlide(shapes, from, motion, stats.radius);
      position.x = slide.position.x;
      position.z = slide.position.z;
      clipVelocity(v, slide.touching);
      if (debugDraw.enabled) drawSlide(from, motion, slide, stats.radius);
    }

    // Moving, the facing follows where the body actually went (along a wall it slides on), not
    // where it's pushing. Blocked (it wants to go somewhere but didn't move), it turns toward where
    // it wants to go.
    const moved = { x: (position.x - start.x) / dt, z: (position.z - start.z) / dt };
    const speed = dmath.hypot(v.x, v.z);
    const moving = dmath.hypot(moved.x, moved.z) > FACE_MIN_SPEED;
    const toward = moving ? moved : desired;
    if (moving || dmath.hypot(desired.x, desired.z) > 0) {
      let turn = wrapAngle(dmath.atan2(toward.x, toward.z) - transform.rotation.y);
      if (Math.abs(turn) > Math.PI - REVERSE_BAND) {
        // A reversal undoes the last turn: moving W, A/D flips back and forth through W instead
        // of spinning round in full circles.
        if (Math.sign(turn) === mover.turnSide) turn -= mover.turnSide * 2 * Math.PI;
      } else if (turn !== 0) {
        mover.turnSide = turn > 0 ? 1 : -1;
      }
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

/**
 * The static obstacles plus a circle for every other solid body (its movement radius, where it
 * stands now). Bodies move one after another in world order, so each sees the others' latest spot.
 */
function withBodies(
  statics: readonly ObstacleShape[],
  solids: Iterable<Entity & Required<Pick<Entity, "transform">>>,
  self: Entity,
): ObstacleShape[] {
  const shapes = [...statics];
  for (const other of solids) {
    if (other === self) continue;
    const { x, z } = other.transform.position;
    shapes.push({ kind: "circle", x, z, r: movementStats(other).radius });
  }
  return shapes;
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
