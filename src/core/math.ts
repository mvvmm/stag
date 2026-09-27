export const TAU = Math.PI * 2;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps an angle to [-PI, PI). */
export function wrapAngle(angle: number): number {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}

/** Interpolates between two angles (radians) along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** A point or direction on the ground plane (world x/z). */
export type Vec2 = { x: number; z: number };

/**
 * Rotates a screen-space direction (x = right, z = up/forward) into world ground-plane space for
 * a camera with the given yaw (radians around +Y; 0 looks along +Z, left-handed like Babylon).
 */
export function rotateByYaw(v: Vec2, yaw: number): Vec2 {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: v.x * cos + v.z * sin, z: -v.x * sin + v.z * cos };
}

/** Scales `v` down to length 1 if it's longer; shorter vectors are returned unchanged. */
export function normalizeClamp(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.z);
  return length > 1 ? { x: v.x / length, z: v.z / length } : { x: v.x, z: v.z };
}

/**
 * Where a ray hits the horizontal plane at height `y`, or null if it points away from (or along)
 * the plane.
 */
export function rayToGround(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  y: number,
): Vec2 | null {
  if (Math.abs(direction.y) < 1e-9) return null;
  const t = (y - origin.y) / direction.y;
  if (t < 0) return null;
  return { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
}
