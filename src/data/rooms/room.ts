import { dmath } from "@/core/dmath";
import { rotateByYaw, type Vec2 } from "@/core/math";
import type { DummySpawn } from "@/data/dummies";

// Hand-built rooms as plain data (meters; +X east, +Z north, centered on the origin). A scene
// turns a room into static obstacle entities; collision (1.3) and the view both read those.

/** What an obstacle is, which picks its grey-box material (and later its art). */
export type ObstacleType = "wall" | "low" | "block" | "pillar" | "dummy";

/** An obstacle's footprint on the ground plane. */
export type ObstacleShape =
  | { kind: "circle"; x: number; z: number; r: number }
  /** `w` along X and `d` along Z before rotating by `yaw` (radians around +Y, like `rotation.y`). */
  | { kind: "box"; x: number; z: number; w: number; d: number; yaw: number };

export type Obstacle = {
  type: ObstacleType;
  shape: ObstacleShape;
  /** Height above the ground. Collision is 2D and ignores it; the view and later line of sight use it. */
  height: number;
};

export type Room = {
  id: string;
  /** Inner size along X. */
  width: number;
  /** Inner size along Z. */
  depth: number;
  spawn: Vec2;
  obstacles: Obstacle[];
  /** Training dummies (the Training yard). */
  dummies?: DummySpawn[];
};

export const WALL_HEIGHT = 3;
export const WALL_THICKNESS = 1;

/**
 * Four tall walls closing a `width` × `depth` room centered on the origin, outside the inner area.
 * The east/west walls run the full outer depth so the corners are closed.
 */
export function perimeterWalls(
  width: number,
  depth: number,
  { thickness = WALL_THICKNESS, height = WALL_HEIGHT } = {},
): Obstacle[] {
  const wall = (x: number, z: number, w: number, d: number): Obstacle => ({
    type: "wall",
    shape: { kind: "box", x, z, w, d, yaw: 0 },
    height,
  });
  const outerDepth = depth + thickness * 2;
  return [
    wall(0, depth / 2 + thickness / 2, width, thickness),
    wall(0, -depth / 2 - thickness / 2, width, thickness),
    wall(width / 2 + thickness / 2, 0, thickness, outerDepth),
    wall(-width / 2 - thickness / 2, 0, thickness, outerDepth),
  ];
}

/** A box footprint's corners in world space, counter-clockwise seen from above. */
export function boxCorners(shape: Extract<ObstacleShape, { kind: "box" }>): Vec2[] {
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((corner) => {
    const p = rotateByYaw(corner, shape.yaw);
    return { x: shape.x + p.x, z: shape.z + p.z };
  });
}

/** Distance from `p` to the shape's outline: positive outside, negative inside. */
export function distanceToShape(p: Vec2, shape: ObstacleShape): number {
  if (shape.kind === "circle") return dmath.hypot(p.x - shape.x, p.z - shape.z) - shape.r;
  // Into the box's local frame (the inverse rotation), then the usual box distance.
  const local = rotateByYaw({ x: p.x - shape.x, z: p.z - shape.z }, -shape.yaw);
  const qx = Math.abs(local.x) - shape.w / 2;
  const qz = Math.abs(local.z) - shape.d / 2;
  const outside = dmath.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qz), 0);
}

/** The shape's axis-aligned bounds on the ground plane. */
export function shapeBounds(shape: ObstacleShape): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  if (shape.kind === "circle") {
    return {
      minX: shape.x - shape.r,
      maxX: shape.x + shape.r,
      minZ: shape.z - shape.r,
      maxZ: shape.z + shape.r,
    };
  }
  const corners = boxCorners(shape);
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
