import { dmath } from "@/core/dmath";
import { rotateByYaw, type Vec2 } from "@/core/math";
import { distanceToShape, type ObstacleShape } from "@/data/rooms/room";

// Exact 2D geometry against obstacle footprints grown by a radius (`pad`): a circle grows into a
// bigger circle, a box into a rounded rectangle. Pathing uses it for line of sight and to push goals
// out of obstacles; collision (1.3) builds on it too.

/** Whether `p` is closer than `pad` to the shape (inside the grown shape). */
export function insidePadded(p: Vec2, shape: ObstacleShape, pad: number): boolean {
  return distanceToShape(p, shape) < pad;
}

/** The closest point to `p` that is at least `pad` from the shape (`p` itself if it already is). */
export function pushOut(p: Vec2, shape: ObstacleShape, pad: number): Vec2 {
  if (distanceToShape(p, shape) >= pad) return { x: p.x, z: p.z };
  if (shape.kind === "circle") {
    const dx = p.x - shape.x;
    const dz = p.z - shape.z;
    const length = dmath.hypot(dx, dz);
    // Dead center has no direction: go east.
    const [ux, uz] = length > 1e-9 ? [dx / length, dz / length] : [1, 0];
    const r = shape.r + pad;
    return { x: shape.x + ux * r, z: shape.z + uz * r };
  }
  const local = rotateByYaw({ x: p.x - shape.x, z: p.z - shape.z }, -shape.yaw);
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  let out: Vec2;
  if (Math.abs(local.x) <= hw && Math.abs(local.z) <= hd) {
    // Inside the box itself: out through the nearest side.
    const toX = hw - Math.abs(local.x);
    const toZ = hd - Math.abs(local.z);
    out =
      toX <= toZ
        ? { x: (local.x < 0 ? -1 : 1) * (hw + pad), z: local.z }
        : { x: local.x, z: (local.z < 0 ? -1 : 1) * (hd + pad) };
  } else {
    // In the padding: away from the closest point on the box.
    const cx = Math.min(hw, Math.max(-hw, local.x));
    const cz = Math.min(hd, Math.max(-hd, local.z));
    const dx = local.x - cx;
    const dz = local.z - cz;
    const length = dmath.hypot(dx, dz);
    out = { x: cx + (dx / length) * pad, z: cz + (dz / length) * pad };
  }
  const world = rotateByYaw(out, shape.yaw);
  return { x: shape.x + world.x, z: shape.z + world.z };
}

/** Distance from `p` to the segment `a`–`b`. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq)) : 0;
  return dmath.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Closest distance between the segment `a`–`b` and the shape (0 if they touch or cross). */
export function segmentDistance(a: Vec2, b: Vec2, shape: ObstacleShape): number {
  if (shape.kind === "circle") return Math.max(0, pointSegmentDistance(shape, a, b) - shape.r);
  // Into the box's frame, where it's axis-aligned around the origin.
  const la = rotateByYaw({ x: a.x - shape.x, z: a.z - shape.z }, -shape.yaw);
  const lb = rotateByYaw({ x: b.x - shape.x, z: b.z - shape.z }, -shape.yaw);
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  if (segmentHitsBox(la, lb, hw, hd)) return 0;
  // Apart, so the closest pair has an endpoint of one of them: segment ends vs box, corners vs segment.
  const box = { kind: "box", x: 0, z: 0, w: shape.w, d: shape.d, yaw: 0 } as const;
  let best = Math.min(distanceToShape(la, box), distanceToShape(lb, box));
  for (const cx of [-hw, hw]) {
    for (const cz of [-hd, hd]) {
      best = Math.min(best, pointSegmentDistance({ x: cx, z: cz }, la, lb));
    }
  }
  return best;
}

/** Slab test: does the segment cross the axis-aligned box of half size hw × hd at the origin? */
function segmentHitsBox(a: Vec2, b: Vec2, hw: number, hd: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const slab = (start: number, delta: number, half: number): boolean => {
    if (delta === 0) return Math.abs(start) <= half;
    let near = (-half - start) / delta;
    let far = (half - start) / delta;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    return t0 <= t1;
  };
  return slab(a.x, b.x - a.x, hw) && slab(a.z, b.z - a.z, hd);
}

/** Whether a body of radius `pad` can move along `a`–`b` without touching the shape. */
export function segmentClear(a: Vec2, b: Vec2, shape: ObstacleShape, pad: number): boolean {
  return segmentDistance(a, b, shape) >= pad;
}
