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
/** Safety-net passes when a move still ends up overlapping something (per circle of the body). */
const PUSH_PASSES = 3;
/** A body made of a single circle at its center. */
const CENTER: readonly Vec2[] = [{ x: 0, z: 0 }];

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
 * Moves a body by `motion` through the obstacles without entering any: it casts along the motion,
 * stops just short of the first hit, keeps only the part of what's left that runs along the surface
 * (projected sliding), and casts again. In a wedge, where the slide would run into a surface it
 * already touched this move, it stops. If the end still overlaps something by more than the skin,
 * it's pushed out. The body is circles of `radius` at `circles` (offsets from `from`, see
 * `footprintCircles`): one at the center by default, a row along the spine for a pill.
 */
export function moveAndSlide(
  shapes: readonly ObstacleShape[],
  from: Vec2,
  motion: Vec2,
  radius: number,
  circles: readonly Vec2[] = CENTER,
): SlideResult {
  const position = { x: from.x, z: from.z };
  const contacts: Contact[] = [];
  const nearby = near(shapes, from, dmath.hypot(motion.x, motion.z) + reachOf(circles, radius));
  let m = { x: motion.x, z: motion.z };

  for (let cast = 0; cast < MAX_CASTS && (m.x !== 0 || m.z !== 0); cast++) {
    let hit: Hit | null = null;
    let hitShape: ObstacleShape | null = null;
    let hitCircle: Vec2 = CENTER[0] as Vec2;
    for (const shape of nearby) {
      for (const circle of circles) {
        const start = { x: position.x + circle.x, z: position.z + circle.z };
        const h = castCircle(start, m, shape, radius);
        if (h && (!hit || h.t < hit.t)) {
          hit = h;
          hitShape = shape;
          hitCircle = circle;
        }
      }
    }
    if (!hit) {
      position.x += m.x;
      position.z += m.z;
      break;
    }
    const length = dmath.hypot(m.x, m.z);
    const t = Math.max(0, hit.t - SKIN / length);
    const cx = position.x + hitCircle.x + m.x * hit.t;
    const cz = position.z + hitCircle.z + m.z * hit.t;
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
    const others = touchingNormals(nearby, position, radius, circles, hitShape);
    if (intoAny(m, others)) break;
  }

  const depenetrated = pushClear(shapes, position, radius, circles, PUSH_PASSES * circles.length);
  return {
    position,
    contacts,
    touching: touchingNormals(
      depenetrated ? near(shapes, position, reachOf(circles, radius)) : nearby,
      position,
      radius,
      circles,
    ),
    depenetrated,
  };
}

export type FitResult = {
  /** Where the body ends up: `at`, or moved just clear of what it overlapped. */
  position: Vec2;
  /** Whether it ends up clear of every obstacle (beyond the skin). */
  fits: boolean;
};

/** Passes `fitBody` gets to push a body clear. */
const FIT_PASSES = 8;

/**
 * Fits a body (circles of `radius` at `circles` around `at`) among the obstacles: if some part
 * overlaps one, the whole body is pushed straight out of the deepest overlap, a few times over.
 * Used when a long body turns: its ends swing, and a wall they swing into pushes it aside. `fits`
 * is false when it's still overlapping after that (caught between obstacles), and the caller
 * shouldn't take the new pose.
 */
export function fitBody(
  shapes: readonly ObstacleShape[],
  at: Vec2,
  radius: number,
  circles: readonly Vec2[],
): FitResult {
  const position = { x: at.x, z: at.z };
  pushClear(shapes, position, radius, circles, FIT_PASSES);
  const nearby = near(shapes, position, reachOf(circles, radius));
  return { position, fits: !deepest(nearby, position, radius, circles) };
}

/** How far from the body's center an obstacle can be and still touch it. */
function reachOf(circles: readonly Vec2[], radius: number): number {
  let far = 0;
  for (const c of circles) far = Math.max(far, dmath.hypot(c.x, c.z));
  return far + radius + TOUCH;
}

/** The deepest overlap of any circle of the body with any shape (beyond the skin), or null. */
function deepest(
  shapes: readonly ObstacleShape[],
  position: Vec2,
  radius: number,
  circles: readonly Vec2[],
): { shape: ObstacleShape; circle: Vec2 } | null {
  let found: { shape: ObstacleShape; circle: Vec2 } | null = null;
  let most = SKIN;
  for (const shape of shapes) {
    for (const circle of circles) {
      const c = { x: position.x + circle.x, z: position.z + circle.z };
      const depth = radius - distanceToShape(c, shape);
      if (depth > most) {
        most = depth;
        found = { shape, circle };
      }
    }
  }
  return found;
}

/**
 * The safety net: while some circle overlaps a shape, moves the whole body (in place) so that
 * circle is just clear of it. Each pass looks at the shapes near where the body is now, since a
 * push can carry it toward ones it wasn't near. Returns whether it moved it.
 */
function pushClear(
  shapes: readonly ObstacleShape[],
  position: Vec2,
  radius: number,
  circles: readonly Vec2[],
  passes: number,
): boolean {
  const reach = reachOf(circles, radius);
  let moved = false;
  for (let pass = 0; pass < passes; pass++) {
    const overlap = deepest(near(shapes, position, reach), position, radius, circles);
    if (!overlap) break;
    const { shape, circle } = overlap;
    const c = { x: position.x + circle.x, z: position.z + circle.z };
    const out = pushOut(c, shape, radius);
    position.x += out.x - c.x;
    position.z += out.z - c.z;
    moved = true;
  }
  return moved;
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

/**
 * Normals of the shapes (but `except`) that the body at `p` touches or overlaps, one per shape,
 * taken at the circle closest to it.
 */
function touchingNormals(
  shapes: readonly ObstacleShape[],
  p: Vec2,
  radius: number,
  circles: readonly Vec2[],
  except: ObstacleShape | null = null,
): Vec2[] {
  const normals: Vec2[] = [];
  for (const shape of shapes) {
    if (shape === except) continue;
    let closest: Vec2 | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const circle of circles) {
      const c = { x: p.x + circle.x, z: p.z + circle.z };
      const d = distanceToShape(c, shape);
      if (d < distance) {
        distance = d;
        closest = c;
      }
    }
    if (closest && distance - radius <= TOUCH) normals.push(surfaceNormal(closest, shape));
  }
  return normals;
}

/**
 * The shapes within `reach` of `from`. Slides turn the motion but never lengthen it, so everything
 * a move can touch is within the motion's length plus the body's reach from its start.
 */
function near(shapes: readonly ObstacleShape[], from: Vec2, reach: number): ObstacleShape[] {
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
