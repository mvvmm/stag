import type { World } from "miniplex";
import { applyEffects, castFacing, enemyOf, gapTo, resolveAim } from "@/combat/abilities";
import { debugDraw } from "@/core/debugDraw";
import { ABILITIES, type AbilityDef, type AbilityStats, abilityById } from "@/data/abilities";
import { entityByUid } from "@/ecs/uid";
import type { CastAim, Caster, Entity, SlotId } from "@/ecs/world";
import { movementStats } from "@/systems/movementStats";

/** Float slack when comparing accumulated tick time with a phase's length, s. */
const EPSILON = 1e-9;

type CasterEntity = Entity & { caster: Caster };

/**
 * Runs every caster's abilities (the player now, enemies in 3.1), after its controller has set
 * `caster.target` and `caster.queued` and before locomotion moves it:
 * - cooldowns count down, and a buffered press expires after `abilities.buffer` seconds
 * - a running cast advances: the windup, then the effects (once, or every pulse of a channel)
 * - with no cast running, a buffered press starts once its slot is ready and its aim is valid;
 *   otherwise the auto attack (the primary slot) starts on `caster.target` whenever it's ready and
 *   the target is in range. A cast's cooldown starts when the cast does.
 * - while a cast roots, the caster's desired velocity is zero; it faces its aim (`cast.face`)
 */
export function castingSystem(world: World<Entity>, dt: number): void {
  for (const entity of world.with("caster")) {
    const { caster } = entity;
    for (const slot of Object.values(caster.slots)) {
      if (slot) slot.cooldown = entity.noCooldowns ? 0 : Math.max(0, slot.cooldown - dt);
    }
    if (caster.queued) {
      caster.queued.age += dt;
      if (caster.queued.age > ABILITIES.buffer + EPSILON) caster.queued = null;
    }
    // A target that's gone (or no longer an enemy) is dropped.
    if (caster.target !== null && !enemyOf(world, entity, caster.target)) caster.target = null;

    if (caster.cast) {
      cancelIfMoving(entity);
      if (caster.cast) advance(world, entity, dt);
    }
    if (!caster.cast) tryStart(world, entity);

    const cast = caster.cast;
    if (cast) {
      const def = abilityById(cast.ability);
      const rooted = def && (cast.phase === "windup" ? def.rootsWindup : def.rootsChannel);
      if (rooted && entity.mover) {
        entity.mover.desired.x = 0;
        entity.mover.desired.z = 0;
      }
      // Re-aimed every tick, so it tracks a target that moves.
      cast.face = castFacing(world, entity, cast.aim);
    }
    if (debugDraw.enabled) draw(world, entity);
  }
}

/** Starts a buffered press, or else the auto attack, if it can go now. */
function tryStart(world: World<Entity>, entity: CasterEntity): void {
  const { caster } = entity;
  const queued = caster.queued;
  if (queued) {
    const found = ready(entity, queued.slot);
    if (!found) return;
    const aim = resolveAim(world, found.def, found.stats, entity, queued);
    // Not valid yet (e.g. out of range): it keeps waiting until the buffer runs out.
    if (!aim) return;
    caster.queued = null;
    start(world, entity, queued.slot, found.def, found.stats, aim);
    return;
  }
  if (caster.target === null) return;
  const found = ready(entity, "primary");
  if (!found) return;
  const target = entityByUid(world, caster.target)?.transform?.position;
  if (!target) return;
  const request = { point: { x: target.x, z: target.z }, target: caster.target };
  const aim = resolveAim(world, found.def, found.stats, entity, request);
  if (aim) start(world, entity, "primary", found.def, found.stats, aim);
}

/** The ability in `slot` and its stats, if the slot has one and it's off cooldown. */
function ready(
  entity: CasterEntity,
  slot: SlotId,
): { def: AbilityDef; stats: AbilityStats } | null {
  const state = entity.caster.slots[slot];
  if (!state || state.cooldown > EPSILON) return null;
  const def = abilityById(state.ability);
  return def ? { def, stats: def.stats(entity) } : null;
}

function start(
  world: World<Entity>,
  entity: CasterEntity,
  slot: SlotId,
  def: AbilityDef,
  stats: AbilityStats,
  aim: CastAim,
): void {
  const { caster } = entity;
  const state = caster.slots[slot];
  if (state) state.cooldown = entity.noCooldowns ? 0 : stats.cooldown;
  caster.cast = {
    slot,
    ability: def.id,
    phase: "windup",
    elapsed: 0,
    aim,
    pulses: 0,
    face: castFacing(world, entity, aim),
  };
  caster.casts++;
  // An instant ability (no windup) goes off right away.
  advance(world, entity, 0);
}

/** Moves the running cast on by `dt`: the windup, then its effects (once, or a channel's pulses). */
function advance(world: World<Entity>, entity: CasterEntity, dt: number): void {
  const { caster } = entity;
  const cast = caster.cast;
  if (!cast) return;
  const def = abilityById(cast.ability);
  if (!def) {
    caster.cast = null;
    return;
  }
  const stats = def.stats(entity);
  cast.elapsed += dt;
  if (cast.phase === "windup") {
    if (cast.elapsed + EPSILON < stats.windup) return;
    if (!stats.channel) {
      applyEffects(world, entity, cast.aim, stats.effects);
      caster.cast = null;
      return;
    }
    cast.phase = "channel";
    cast.elapsed -= stats.windup;
  }
  const channel = stats.channel;
  if (!channel) {
    caster.cast = null;
    return;
  }
  // Pulses at interval, 2 × interval, … up to the end of the channel.
  const interval = Math.max(channel.interval, EPSILON);
  for (;;) {
    const at = (cast.pulses + 1) * interval;
    if (at > cast.elapsed + EPSILON || at > channel.duration + EPSILON) break;
    applyEffects(world, entity, cast.aim, stats.effects);
    cast.pulses++;
  }
  if (cast.elapsed + EPSILON >= channel.duration) caster.cast = null;
}

/** A channel that moving cancels ends when its caster's controller asks to move. */
function cancelIfMoving(entity: CasterEntity): void {
  const cast = entity.caster.cast;
  if (cast?.phase !== "channel") return;
  const def = abilityById(cast.ability);
  const desired = entity.mover?.desired;
  if (def?.movingCancels && desired && (desired.x !== 0 || desired.z !== 0)) {
    entity.caster.cast = null;
  }
}

/**
 * The `abilities` debug category: the auto attack's reach round the caster (its movement circle
 * plus the range), a line to its target (green in range, grey out of it), and the cast's phase.
 */
function draw(world: World<Entity>, entity: CasterEntity): void {
  const at = entity.transform?.position;
  if (!at) return;
  const style = { category: "abilities" } as const;
  const primary = entity.caster.slots.primary;
  const def = primary && abilityById(primary.ability);
  if (def?.aim === "target") {
    const range = def.stats(entity).range;
    debugDraw.circle(at, movementStats(entity).radius + range, { ...style, color: "blue" });
    const target = enemyOf(world, entity, entity.caster.target);
    if (target) {
      const near = gapTo(entity, target) <= range;
      debugDraw.line(at, target.transform.position, { ...style, color: near ? "green" : "grey" });
    }
  }
  const cast = entity.caster.cast;
  const label = cast
    ? `${cast.ability} ${cast.phase} ${cast.elapsed.toFixed(2)}s`
    : `ready in ${(primary?.cooldown ?? 0).toFixed(2)}s`;
  debugDraw.text({ x: at.x, y: 2, z: at.z }, label, { ...style, color: "white" });
}
