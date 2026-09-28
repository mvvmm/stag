import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";

// A mover's footprint on the ground: a circle, or a pill (a capsule lying along the facing: a
// cat's long body). Collision treats a pill as a row of overlapping circles along its spine, close
// enough (at most half a radius apart) that the scallops between them are under 1.5% of the radius
// deep; a circle is the row of one. Each form will bring its own footprint (10.1).

export type Footprint = {
  /** Half the width, m. */
  radius: number;
  /** Nose to tail end, m. At most 2 × radius it's a circle. */
  length: number;
};

/** Circles along a pill's spine are at most this many radii apart. */
const SPACING = 0.5;

/** Half the length of the spine between the two end caps' centers, m (0 for a circle). */
export function halfSpine({ radius, length }: Footprint): number {
  return Math.max(0, length / 2 - radius);
}

/**
 * Where the footprint's circles sit relative to its center, for a body facing `facing` (yaw 0
 * looks along +Z): one at the center for a circle, a row along the facing for a pill.
 */
export function footprintCircles(footprint: Footprint, facing: number): Vec2[] {
  const half = halfSpine(footprint);
  if (half <= 0) return [{ x: 0, z: 0 }];
  const count = Math.ceil((2 * half) / (footprint.radius * SPACING)) + 1;
  const dx = dmath.sin(facing);
  const dz = dmath.cos(facing);
  const circles: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const along = -half + (2 * half * i) / (count - 1);
    circles.push({ x: dx * along, z: dz * along });
  }
  return circles;
}
