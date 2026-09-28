import { castCircle, type Hit, surfaceNormal } from "@/collision/cast";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import { distanceToShape, type ObstacleShape, shapeBounds } from "@/data/rooms/room";
import { pushOut } from "@/nav/shapes";

/** How far a hit backs off along the motion, m, so the next cast starts clear of the surface. */
export const SKIN = 0.001;
/** Casts per move: the first motion plus up to three slides. What's left after that is dropped. */
const MAX_CASTS = 4;
/** A circle within this of a surface (beyond its radius) touches it. */
const TOUCH = 2 * SKIN;
/** Safety-net passes when a move still ends up overlapping something. */
const PUSH_PASSES = 3;

export type Contact = {
  /** Where the circle touched the obstacle's outline. */
  point: Vec2;
  /** Outward surface normal there (unit length). */
  normal: Vec2;
};

export type SlideResult = {
  position: Vec2;
  /** Every surface the move ran into, in order. */
  contacts: Contact[];
  /** Outward normals of the surfaces the circle touches where it ends up (for `clipVelocity`). */
  touching: Vec2[];
  /** The safety net had to push the circle out of an overlap (a start inside, or a bug). */
  depenetrated: boolean;
};

/**
 * Moves a circle by `motion` through the obstacles without entering any: it casts along the motion,
 * stops just short of the first hit, keeps only the part of what's left that runs along the surface
 * (projected sliding), and casts again. In a wedge, where the slide would run into a surface it
 * already touched this move, it stops. If the end still overlaps something by more than the skin,
 * it's pushed out.
 */
export function moveAndSlide(
  shapes: readonly ObstacleShape[],
  from: Vec2,
  motion: Vec2,
  radius: number,
): SlideResult {
  const position = { x: from.x, z: from.z };
  const contacts: Contact[] = [];
  const nearby = near(shapes, from, motion, radius);
  let m = { x: motion.x, z: motion.z };

  for (let cast = 0; cast < MAX_CASTS && (m.x !== 0 || m.z !== 0); cast++) {
    let hit: Hit | null = null;
    let hitShape: ObstacleShape | null = null;
    for (const shape of nearby) {
      const h = castCircle(position, m, shape, radius);
      if (h && (!hit || h.t < hit.t)) {
        hit = h;
        hitShape = shape;
      }
    }
    if (!hit) {
      position.x += m.x;
      position.z += m.z;
      break;
    }
    const length = dmath.hypot(m.x, m.z);
    const t = Math.max(0, hit.t - SKIN / length);
    const cx = position.x + m.x * hit.t;
    const cz = position.z + m.z * hit.t;
    position.x += m.x * t;
    position.z += m.z * t;
    const n = hit.normal;
    contacts.push({ point: { x: cx - n.x * radius, z: cz - n.z * radius }, normal: n });

    // What's left, minus its part into the surface.
    const left = 1 - t;
    m = { x: m.x * left, z: m.z * left };
    const into = m.x * n.x + m.z * n.z;
    m.x -= into * n.x;
    m.z -= into * n.z;
    // The slide runs along this surface; if it goes into another one it's touching, it's wedged.
    const others = touchingNormals(nearby, position, radius, hitShape);
    if (intoAny(m, others)) break;
  }

  let depenetrated = false;
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const inside = nearby.find((shape) => distanceToShape(position, shape) < radius - SKIN);
    if (!inside) break;
    const out = pushOut(position, inside, radius);
    position.x = out.x;
    position.z = out.z;
    depenetrated = true;
  }
  return { position, contacts, touching: touchingNormals(nearby, position, radius), depenetrated };
}

/**
 * Takes the velocity's part into each touched surface out, so it doesn't keep pushing into a wall
 * it's sliding along. In a wedge (still going into one of them after that) it stops.
 */
export function clipVelocity(v: Vec2, normals: readonly Vec2[]): void {
  for (const n of normals) {
    const into = v.x * n.x + v.z * n.z;
    if (into < 0) {
      v.x -= into * n.x;
      v.z -= into * n.z;
    }
  }
  if (intoAny(v, normals)) {
    v.x = 0;
    v.z = 0;
  }
}

/** Whether `v` points into any of the surfaces (beyond rounding errors). */
function intoAny(v: Vec2, normals: readonly Vec2[]): boolean {
  const length = dmath.hypot(v.x, v.z);
  return normals.some((n) => v.x * n.x + v.z * n.z < -1e-9 * length);
}

/** Normals of the shapes (but `except`) that a circle at `p` touches or overlaps. */
function touchingNormals(
  shapes: readonly ObstacleShape[],
  p: Vec2,
  radius: number,
  except: ObstacleShape | null = null,
): Vec2[] {
  const normals: Vec2[] = [];
  for (const shape of shapes) {
    if (shape !== except && distanceToShape(p, shape) - radius <= TOUCH) {
      normals.push(surfaceNormal(p, shape));
    }
  }
  return normals;
}

/**
 * The shapes the move could reach. Slides turn the motion but never lengthen it, so everything it
 * can touch is within the motion's length plus the radius of the start, in any direction.
 */
function near(
  shapes: readonly ObstacleShape[],
  from: Vec2,
  motion: Vec2,
  radius: number,
): ObstacleShape[] {
  const reach = dmath.hypot(motion.x, motion.z) + radius + TOUCH;
  return shapes.filter((shape) => {
    const b = shapeBounds(shape);
    return (
      b.minX <= from.x + reach &&
      b.maxX >= from.x - reach &&
      b.minZ <= from.z + reach &&
      b.maxZ >= from.z - reach
    );
  });
}
