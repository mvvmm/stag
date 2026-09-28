// Pure atmosphere math (no Babylon, so it's tested in Node). `heightFogDepth` documents the WGSL
// in `heightFog.ts`, which does the same thing per pixel.

type Point = { x: number; y: number; z: number };

/** Height fog: `density` per meter up to `base`, thinning by e every `falloff` meters above it. */
export type HeightFog = { density: number; base: number; falloff: number };

/** Below this vertical change a ray counts as level, and the density along it as constant. */
const LEVEL = 1e-4;

/** The fog density at height `y`. */
export function heightFogDensity(y: number, fog: HeightFog): number {
  return fog.density * Math.exp(-Math.max(y - fog.base, 0) / fog.falloff);
}

/**
 * The fog's optical depth along the straight line from `from` (the camera) to `to` (the shaded
 * point), in closed form: a constant density below `base` and an exponential one above it. The
 * ray is split where it crosses `base`, and the part above integrates to
 * `density · falloff · |e(y1) − e(y2)| · length / |Δy|`, with `e(y) = exp(−(y − base) / falloff)`.
 */
export function heightFogDepth(from: Point, to: Point, fog: HeightFog): number {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const dy = to.y - from.y;
  if (Math.abs(dy) < LEVEL) return heightFogDensity((from.y + to.y) / 2, fog) * length;
  const lo = Math.min(from.y, to.y);
  const hi = Math.max(from.y, to.y);
  const perMeter = length / Math.abs(dy);
  // The part of the height span below `base` has constant density.
  const below = Math.max(0, Math.min(hi, fog.base) - lo);
  const e = (y: number) => Math.exp(-(Math.max(y, fog.base) - fog.base) / fog.falloff);
  const above = fog.falloff * (e(lo) - e(hi));
  return fog.density * perMeter * (below + above);
}

/** How much fog covers a point with this optical depth (0 = none, 1 = all). */
export function fogAmount(depth: number): number {
  return 1 - Math.exp(-depth);
}

/** The player light's breathing: 1 ± `amount`, a sine at `speed` cycles per second. */
export function pulse(seconds: number, amount: number, speed: number): number {
  return 1 + amount * Math.sin(seconds * speed * Math.PI * 2);
}

/** An axis-aligned box in world space. */
export type Box3 = { min: Point; max: Point };

/**
 * Where a directional light's shadow camera sits and what it covers so that its orthographic
 * frustum just contains `box`: extents in the light's view space (x right, y up, z along the light)
 * and the near/far planes. The basis matches Babylon's `Matrix.LookAtLH(position, position +
 * direction, up)` with up = +Y, which its shadow generator uses.
 */
export type ShadowFrustum = {
  position: Point;
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point, b: Point): Point => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (a: Point): Point => {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/** The light-view axes for a light shining along `direction` (Babylon's LookAtLH with up +Y). */
export function lightBasis(direction: Point): { x: Point; y: Point; z: Point } {
  const z = normalize(direction);
  // Straight down (or up) has no horizontal part; any horizontal x axis will do.
  const sideways = cross({ x: 0, y: 1, z: 0 }, z);
  const x =
    Math.hypot(sideways.x, sideways.y, sideways.z) < 1e-6
      ? { x: 1, y: 0, z: 0 }
      : normalize(sideways);
  return { x, y: cross(z, x), z };
}

/** The box's eight corners. */
export function boxCorners({ min, max }: Box3): Point[] {
  const corners: Point[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push({ x, y, z });
  return corners;
}

/** Fits a directional light's shadow frustum to `box` (see `ShadowFrustum`). */
export function fitShadowFrustum(box: Box3, direction: Point): ShadowFrustum {
  const basis = lightBasis(direction);
  const center = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const radius = Math.hypot(box.max.x - center.x, box.max.y - center.y, box.max.z - center.z);
  // Back far enough along the light that every corner is in front of it.
  const position = {
    x: center.x - basis.z.x * radius,
    y: center.y - basis.z.y * radius,
    z: center.z - basis.z.z * radius,
  };
  const frustum = {
    position,
    left: Infinity,
    right: -Infinity,
    bottom: Infinity,
    top: -Infinity,
    near: Infinity,
    far: -Infinity,
  };
  for (const corner of boxCorners(box)) {
    const local = sub(corner, position);
    const x = dot(local, basis.x);
    const y = dot(local, basis.y);
    const z = dot(local, basis.z);
    frustum.left = Math.min(frustum.left, x);
    frustum.right = Math.max(frustum.right, x);
    frustum.bottom = Math.min(frustum.bottom, y);
    frustum.top = Math.max(frustum.top, y);
    frustum.near = Math.min(frustum.near, z);
    frustum.far = Math.max(frustum.far, z);
  }
  return frustum;
}

/** The direction a light shines from a heading (degrees clockwise from north) and an elevation. */
export function lightDirection(headingDeg: number, elevationDeg: number): Point {
  const heading = (headingDeg * Math.PI) / 180;
  const elevation = (elevationDeg * Math.PI) / 180;
  const flat = Math.cos(elevation);
  // It comes *from* the heading, so it shines the other way, and down.
  return { x: -Math.sin(heading) * flat, y: -Math.sin(elevation), z: -Math.cos(heading) * flat };
}
