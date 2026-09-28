import { dmath } from "@/core/dmath";
import { rotateByYaw, type Vec2 } from "@/core/math";
import { distanceToShape, type ObstacleShape } from "@/data/rooms/room";

// Swept circles against obstacle footprints. A circle of radius `radius` touching a shape is the
// same as its center touching the shape grown by `radius` (a bigger circle, or a box with rounded
// corners), so every cast here is a ray (the center's motion) against a grown shape. Grown shapes
// are convex, which is what makes "moving away from or along the surface never hits" true.

export type Hit = {
  /** Fraction of the motion travelled before touching, in [0, 1]. */
  t: number;
  /** The grown shape's outward surface normal at the contact (unit length). */
  normal: Vec2;
};

/**
 * Motion counts as going into a surface only if it points in by more than this fraction of its
 * length, so a slide that's tangent up to rounding errors doesn't catch on the wall it follows.
 */
const INTO = 1e-9;
/** A center this close to the grown outline (or inside it) starts in contact. */
const CONTACT = 1e-9;

/**
 * The first time the circle at `from` moving by `motion` touches `shape`, or null if it doesn't
 * within the motion. A circle that already touches or overlaps the shape hits at `t = 0` only if
 * it moves into it; moving away or along the surface is free.
 */
export function castCircle(
  from: Vec2,
  motion: Vec2,
  shape: ObstacleShape,
  radius: number,
): Hit | null {
  const length = dmath.hypot(motion.x, motion.z);
  if (length === 0) return null;
  const into = (normal: Vec2) => motion.x * normal.x + motion.z * normal.z < -INTO * length;

  if (distanceToShape(from, shape) - radius <= CONTACT) {
    const normal = surfaceNormal(from, shape);
    return into(normal) ? { t: 0, normal } : null;
  }

  let hit: Hit | null;
  if (shape.kind === "circle") {
    hit = rayCircle(from, motion, shape, shape.r + radius);
  } else {
    // In the box's frame the grown shape is the union of two crossed rectangles and a circle on
    // each corner; the first entry into the union is the earliest entry into any of them.
    const p = rotateByYaw({ x: from.x - shape.x, z: from.z - shape.z }, -shape.yaw);
    const m = rotateByYaw(motion, -shape.yaw);
    const hw = shape.w / 2;
    const hd = shape.d / 2;
    hit = earliest(
      raySlabs(p, m, hw + radius, hd),
      raySlabs(p, m, hw, hd + radius),
      rayCircle(p, m, { x: -hw, z: -hd }, radius),
      rayCircle(p, m, { x: hw, z: -hd }, radius),
      rayCircle(p, m, { x: hw, z: hd }, radius),
      rayCircle(p, m, { x: -hw, z: hd }, radius),
    );
    if (hit) hit = { t: hit.t, normal: rotateByYaw(hit.normal, shape.yaw) };
  }
  return hit && into(hit.normal) ? hit : null;
}

/**
 * The outward normal of the shape's outline nearest to `p` (inside or outside it). It's also the
 * normal of the grown outline there, since growing moves the outline straight out.
 */
export function surfaceNormal(p: Vec2, shape: ObstacleShape): Vec2 {
  if (shape.kind === "circle") {
    const dx = p.x - shape.x;
    const dz = p.z - shape.z;
    const length = dmath.hypot(dx, dz);
    // Dead center has no direction: east, like `pushOut`.
    return length > 1e-12 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
  }
  const local = rotateByYaw({ x: p.x - shape.x, z: p.z - shape.z }, -shape.yaw);
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  let normal: Vec2;
  if (Math.abs(local.x) <= hw && Math.abs(local.z) <= hd) {
    // Inside the box: the nearest side's normal.
    normal =
      hw - Math.abs(local.x) <= hd - Math.abs(local.z)
        ? { x: local.x < 0 ? -1 : 1, z: 0 }
        : { x: 0, z: local.z < 0 ? -1 : 1 };
  } else {
    const dx = local.x - Math.min(hw, Math.max(-hw, local.x));
    const dz = local.z - Math.min(hd, Math.max(-hd, local.z));
    const length = dmath.hypot(dx, dz);
    normal = { x: dx / length, z: dz / length };
  }
  return rotateByYaw(normal, shape.yaw);
}

/** Entry of the ray `p + t·m` (t in [0, 1]) into the circle, if `p` starts outside it. */
function rayCircle(p: Vec2, m: Vec2, center: Vec2, r: number): Hit | null {
  const fx = p.x - center.x;
  const fz = p.z - center.z;
  const a = m.x * m.x + m.z * m.z;
  const b = fx * m.x + fz * m.z; // half of the usual b
  const c = fx * fx + fz * fz - r * r;
  if (c < 0 || b >= 0) return null; // starts inside, or not closing in
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  if (t < 0 || t > 1) return null;
  return { t, normal: { x: (fx + m.x * t) / r, z: (fz + m.z * t) / r } };
}

/** Entry of the ray `p + t·m` (t in [0, 1]) into the axis-aligned rectangle of half size hx × hz. */
function raySlabs(p: Vec2, m: Vec2, hx: number, hz: number): Hit | null {
  let enter = 0;
  let exit = 1;
  let normal: Vec2 | null = null;
  const slab = (start: number, delta: number, half: number, axis: "x" | "z"): boolean => {
    if (delta === 0) return Math.abs(start) <= half;
    let near = (-half - start) / delta;
    let far = (half - start) / delta;
    const sign = delta > 0 ? -1 : 1; // the side the ray enters through faces against it
    if (near > far) [near, far] = [far, near];
    if (near > enter) {
      enter = near;
      normal = axis === "x" ? { x: sign, z: 0 } : { x: 0, z: sign };
    }
    exit = Math.min(exit, far);
    return enter <= exit;
  };
  if (!slab(p.x, m.x, hx, "x") || !slab(p.z, m.z, hz, "z")) return null;
  // No entering side means the ray started inside (callers only cast from outside the union).
  return normal ? { t: enter, normal } : null;
}

function earliest(...hits: (Hit | null)[]): Hit | null {
  let best: Hit | null = null;
  for (const hit of hits) if (hit && (!best || hit.t < best.t)) best = hit;
  return best;
}
