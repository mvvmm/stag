import type { World } from "miniplex";
import { footprintCircles } from "@/collision/body";
import { applyDamage } from "@/combat/damage";
import { type HitShape, targetsIn } from "@/combat/shapes";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import type { AbilityDef, AbilityStats, Area, Effect } from "@/data/abilities";
import { entityByUid } from "@/ecs/uid";
import type { CastAim, Entity } from "@/ecs/world";
import { movementStats } from "@/systems/movementStats";

// The pure parts of casting (Babylon-free, deterministic): who can be targeted, range, aim
// resolution and applying effects. `systems/casting.ts` drives them.

/** A body abilities can target: it has a uid, a place, health and a hurtbox. */
export type Targetable = Entity &
  Required<Pick<Entity, "uid" | "transform" | "health" | "hurtbox">>;

/** Whether `a` and `b` are on different sides (both must have a faction). */
export function hostile(a: Entity, b: Entity): boolean {
  return a.faction !== undefined && b.faction !== undefined && a.faction !== b.faction;
}

/** `uid`'s entity if it's a body `caster` may attack, else undefined. */
export function enemyOf(
  world: World<Entity>,
  caster: Entity,
  uid: number | null,
): Targetable | undefined {
  const entity = entityByUid(world, uid);
  if (!entity || entity === caster || !hostile(caster, entity)) return undefined;
  if (!entity.transform || !entity.health || !entity.hurtbox) return undefined;
  return entity as Targetable;
}

/**
 * The gap between `caster`'s movement circle and `target`'s hurtbox, m (negative when they
 * overlap): what an ability's range is measured against.
 */
export function gapTo(caster: Entity, target: Targetable): number {
  const from = caster.transform?.position ?? { x: 0, z: 0 };
  const { position, rotation } = target.transform;
  let nearest = Number.POSITIVE_INFINITY;
  for (const offset of footprintCircles(target.hurtbox, rotation.y)) {
    const d = dmath.hypot(position.x + offset.x - from.x, position.z + offset.z - from.z);
    nearest = Math.min(nearest, d - target.hurtbox.radius);
  }
  return nearest - movementStats(caster).radius;
}

/** Whether `target` is within `range` of `caster`, edge to edge. */
export function inRange(caster: Entity, target: Targetable, range: number): boolean {
  return gapTo(caster, target) <= range;
}

/**
 * The enemy of `caster` whose hurtbox is nearest `point` (center distance less its hurtbox), within
 * `within` m of it, or undefined. Ties go to the earlier entity, for determinism.
 */
export function nearestEnemy(
  world: World<Entity>,
  caster: Entity,
  point: Vec2,
  within: number,
): Targetable | undefined {
  let best: Targetable | undefined;
  let bestGap = within;
  for (const entity of world.with("uid", "transform", "health", "hurtbox")) {
    if (entity === caster || !hostile(caster, entity)) continue;
    const { position, rotation } = entity.transform;
    for (const offset of footprintCircles(entity.hurtbox, rotation.y)) {
      const d = dmath.hypot(position.x + offset.x - point.x, position.z + offset.z - point.z);
      const gap = Math.max(0, d - entity.hurtbox.radius);
      if (gap < bestGap || (gap === bestGap && !best)) {
        best = entity;
        bestGap = gap;
      }
    }
  }
  return best;
}

/** What a cast request carries: the cursor's ground point and the body under it. */
export type AimRequest = { point: Vec2; target: number | null };

/**
 * Where a cast of `def` by `caster` goes, or null if it can't start now (a `target` ability
 * without a valid enemy in range).
 */
export function resolveAim(
  world: World<Entity>,
  def: AbilityDef,
  stats: AbilityStats,
  caster: Entity,
  request: AimRequest,
): CastAim | null {
  const at = caster.transform?.position ?? { x: 0, z: 0 };
  switch (def.aim) {
    case "target": {
      const target = enemyOf(world, caster, request.target);
      if (!target || !inRange(caster, target, stats.range)) return null;
      return { target: target.uid, point: null, dir: null };
    }
    case "direction":
      return {
        target: null,
        point: { x: request.point.x, z: request.point.z },
        dir: directionTo(at, request.point, caster.transform?.rotation.y ?? 0),
      };
    case "point": {
      const dx = request.point.x - at.x;
      const dz = request.point.z - at.z;
      const d = dmath.hypot(dx, dz);
      const k = d > stats.range && d > 0 ? stats.range / d : 1;
      return { target: null, point: { x: at.x + dx * k, z: at.z + dz * k }, dir: null };
    }
    case "self":
      return { target: null, point: { x: at.x, z: at.z }, dir: null };
  }
}

/**
 * The way `caster` faces for a cast (a unit vector toward its target, point or direction), or
 * null for `self` casts and when it's on top of what it aims at.
 */
export function castFacing(world: World<Entity>, caster: Entity, aim: CastAim): Vec2 | null {
  const at = caster.transform?.position;
  if (!at) return null;
  if (aim.dir) return aim.dir;
  const toward = entityByUid(world, aim.target)?.transform?.position ?? aim.point;
  if (!toward) return null;
  const dx = toward.x - at.x;
  const dz = toward.z - at.z;
  const d = dmath.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : null;
}

/**
 * Applies `effects` of a cast: damage to its target (whatever it's done since the cast started:
 * a started attack always lands, if the target still exists), or to every enemy body an area
 * touches.
 */
export function applyEffects(
  world: World<Entity>,
  caster: Entity,
  aim: CastAim,
  effects: readonly Effect[],
): void {
  for (const effect of effects) {
    if (effect.area === null) {
      const target = entityByUid(world, aim.target);
      if (target?.health) applyDamage({ health: target.health }, effect.amount);
      continue;
    }
    const shape = areaShape(caster, aim, effect.area);
    if (!shape) continue;
    for (const target of targetsIn(world, shape)) {
      if (hostile(caster, target)) applyDamage(target, effect.amount);
    }
  }
}

/** An area placed for a cast, or null if the caster has no place. */
export function areaShape(caster: Entity, aim: CastAim, area: Area): HitShape | null {
  const transform = caster.transform;
  if (!transform) return null;
  const at = { x: transform.position.x, z: transform.position.z };
  const dir = aim.dir ?? directionTo(at, aim.point ?? at, transform.rotation.y);
  switch (area.kind) {
    case "circle":
      return {
        kind: "circle",
        center: area.at === "point" && aim.point ? { ...aim.point } : at,
        radius: area.radius,
      };
    case "cone":
      return { kind: "cone", origin: at, dir, range: area.range, halfAngle: area.halfAngle };
    case "line":
      return { kind: "line", origin: at, dir, length: area.length, halfWidth: area.halfWidth };
  }
}

/** The unit vector from `from` to `to`, or along `facing` when they're the same point. */
function directionTo(from: Vec2, to: Vec2, facing: number): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = dmath.hypot(dx, dz);
  if (d > 1e-6) return { x: dx / d, z: dz / d };
  return { x: dmath.sin(facing), z: dmath.cos(facing) };
}
