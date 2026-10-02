import type { World } from "miniplex";
import { type Footprint, footprintCircles } from "@/collision/body";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import type { Entity } from "@/ecs/world";

// The areas attacks hit, on the ground plane. A hit is an instant area check against the targets'
// hurtboxes: touching the body counts (League-style), not just its center. Obstacles don't block
// it; an ability that needs cover (a projectile, a beam) cuts its shape short with the collision
// casts first.

export type HitShape =
  /** Everything within `radius` of `center`. */
  | { kind: "circle"; center: Vec2; radius: number }
  /** A pie slice from `origin` along `dir` (a unit vector), `halfAngle` radians either side. */
  | { kind: "cone"; origin: Vec2; dir: Vec2; range: number; halfAngle: number }
  /** A rectangle from `origin` along `dir` (a unit vector), `halfWidth` either side. */
  | { kind: "line"; origin: Vec2; dir: Vec2; length: number; halfWidth: number };

/** Whether `shape` touches a circle of `radius` around `center`. */
export function hitsCircle(shape: HitShape, center: Vec2, radius: number): boolean {
  switch (shape.kind) {
    case "circle":
      return distance(shape.center, center) <= shape.radius + radius;
    case "line": {
      const { along, side } = local(shape.origin, shape.dir, center);
      const dx = along - clamp(along, 0, shape.length);
      const dz = side - clamp(side, -shape.halfWidth, shape.halfWidth);
      return dx * dx + dz * dz <= radius * radius;
    }
    case "cone": {
      const { origin, dir, range, halfAngle } = shape;
      const reach = distance(origin, center);
      if (reach > range + radius) return false;
      if (reach <= radius || halfAngle >= Math.PI) return true;
      // Inside the wedge's angle, the nearest point of the slice is straight toward the center.
      const { along, side } = local(origin, dir, center);
      if (along >= reach * dmath.cos(halfAngle)) return true;
      // Outside it, the nearest point is on the edge it's closest to.
      const edge = rotate(dir, side >= 0 ? halfAngle : -halfAngle);
      const t = clamp((center.x - origin.x) * edge.x + (center.z - origin.z) * edge.z, 0, range);
      const nearest = { x: origin.x + edge.x * t, z: origin.z + edge.z * t };
      return distance(nearest, center) <= radius;
    }
  }
}

/** Whether `shape` touches a hurtbox at `at` facing `facing` (a circle, or a pill along it). */
export function hitsHurtbox(shape: HitShape, hurtbox: Footprint, at: Vec2, facing: number) {
  for (const offset of footprintCircles(hurtbox, facing)) {
    if (hitsCircle(shape, { x: at.x + offset.x, z: at.z + offset.z }, hurtbox.radius)) return true;
  }
  return false;
}

type Target = Entity & Required<Pick<Entity, "transform" | "health" | "hurtbox">>;

/**
 * The entities with health whose hurtbox `shape` touches, in the world's (deterministic) order.
 * Draws the shape in the `hits` debug category.
 */
export function targetsIn(world: World<Entity>, shape: HitShape): Target[] {
  if (debugDraw.enabled) drawShape(shape);
  const targets: Target[] = [];
  for (const entity of world.with("transform", "health", "hurtbox")) {
    const { position, rotation } = entity.transform;
    if (hitsHurtbox(shape, entity.hurtbox, position, rotation.y)) targets.push(entity);
  }
  return targets;
}

/** Draws a hit shape (the `hits` debug category), shown for a moment. */
export function drawShape(shape: HitShape, duration = 0.4): void {
  const options = { color: "red", category: "hits", duration } as const;
  if (shape.kind === "circle") {
    debugDraw.circle(shape.center, shape.radius, options);
    return;
  }
  const { origin, dir } = shape;
  if (shape.kind === "line") {
    const right = { x: dir.z * shape.halfWidth, z: -dir.x * shape.halfWidth };
    const end = { x: origin.x + dir.x * shape.length, z: origin.z + dir.z * shape.length };
    debugDraw.path(
      [
        { x: origin.x + right.x, z: origin.z + right.z },
        { x: end.x + right.x, z: end.z + right.z },
        { x: end.x - right.x, z: end.z - right.z },
        { x: origin.x - right.x, z: origin.z - right.z },
      ],
      { ...options, closed: true },
    );
    return;
  }
  const steps = Math.max(2, Math.ceil(shape.halfAngle / 0.1));
  const points: Vec2[] = [origin];
  for (let i = 0; i <= steps; i++) {
    const edge = rotate(dir, -shape.halfAngle + (2 * shape.halfAngle * i) / steps);
    points.push({ x: origin.x + edge.x * shape.range, z: origin.z + edge.z * shape.range });
  }
  debugDraw.path(points, { ...options, closed: true });
}

/** `point` in the frame of a ray: how far along `dir` from `origin`, and how far to its left. */
function local(origin: Vec2, dir: Vec2, point: Vec2): { along: number; side: number } {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  return { along: dx * dir.x + dz * dir.z, side: dz * dir.x - dx * dir.z };
}

/** `v` turned by `angle` radians toward its left (positive `side` in `local`). */
function rotate(v: Vec2, angle: number): Vec2 {
  const c = dmath.cos(angle);
  const s = dmath.sin(angle);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

function distance(a: Vec2, b: Vec2): number {
  return dmath.hypot(a.x - b.x, a.z - b.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
