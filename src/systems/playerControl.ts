import type { World } from "miniplex";
import { enemyOf, gapFromPoint, inRange, nearestEnemy, type Targetable } from "@/combat/abilities";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import type { Rng } from "@/core/rng";
import { defineTunables } from "@/core/tuning";
import { ABILITIES, type AbilityDef, abilityById } from "@/data/abilities";
import {
  type AttackMove,
  type Entity,
  type MoveOrder,
  type QueuedCast,
  SLOTS,
  type SlotId,
} from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { navGraphOf } from "@/nav/graph";
import { findPath } from "@/nav/path";
import { movementStats } from "@/systems/movementStats";

/** A chase repaths once its target is this far (m) from where the path ends. */
const CHASE_REPATH = 0.25;
/** Float slack when comparing a cooldown or the buffer's age with zero or its length, s. */
const EPSILON = 1e-9;

/** moba's attack move (S, then left click), League-style. */
export const ATTACK_MOVE = defineTunables("attackMove", {
  /** Short of a hovered enemy, the cat walks to the click and goes for the first enemy that comes
   * within this of its body (edge to edge), m. */
  acquire: { value: 2.5, min: 0, max: 20, step: 0.1 },
});

/**
 * Turns input into the player's desired velocity for `locomotion`, and its auto attack target and
 * ability presses for `casting`:
 * - WASD asks for `move · speed` and drops any click-to-move order.
 * - A move command (right-click) paths around obstacles to the cursor. Holding the button steers: it
 *   repaths whenever the cursor moves (a query is well under a millisecond).
 * - Following an order runs at full speed through the corners and brakes on the last leg just in
 *   time (`√(2·decel·distance)`) to land on the goal, where it stops dead.
 * - `stop` drops the order and the attack target, so the player brakes.
 * - The auto attack (`primary`) attacks the enemy you click (`input.hover`, picked on screen), and
 *   keeps attacking it until another order (abilities don't count):
 *   - WASD: holding the button over an enemy makes it the target, so A + click moves left and
 *     attacks whatever's under the cursor whenever the attack is ready and it's in range. Moving
 *     or clicking off any enemy drops the target. An enemy out of range waits until you walk up.
 *   - moba: a right-click on an enemy is an attack order (the cat chases it into range), on the
 *     ground a move order. Holding the button is the same as clicking again every tick.
 * - moba's attack move: `attackMove` (S) arms it (the view shows the auto attack's reach) and a
 *   left click (`confirm`) issues it (Shift + right-click presses both in one tick): chase whatever's hovered (`input.hover`, same as the auto
 *   attack's own targeting), or with nothing hovered walk to the click and go for the first enemy
 *   that comes near on the way — one that wasn't already that near when it was issued, so standing
 *   next to one dummy and attack-moving past it toward another doesn't re-attack the one you're
 *   leaving (unless the click is that near it too: then you're not leaving it). One it would pick up
 *   right away is picked on the spot, so spamming attack moves by the enemy it's attacking keeps
 *   the attack going. It's over once an attack starts; stop, a new right-click or moving drop it (a
 *   right-click still held from before doesn't).
 * - Ability keys cast in one of three modes (see `castModes`): quick cast (the key alone queues a
 *   cast at the cursor, `caster.queued`, for `casting` to start when it can), normal cast (with
 *   `normalCast`: aim first, `player.aiming`, and a left click casts) and self cast (with
 *   `selfCast`). A targeted cast on an enemy out of range walks into range first (`queued.chase`).
 */
export function playerControlSystem(
  world: World<Entity>,
  dt: number,
  _rng: Rng,
  input: InputFrame,
) {
  for (const entity of world.with("transform", "mover", "player")) {
    const { transform, mover, player } = entity;
    const stats = movementStats(entity);
    const position = transform.position;
    const command = input.moveCommand;

    const caster = entity.caster;
    const hovered = caster ? enemyOf(world, entity, input.hover) : undefined;

    if (input.pressed.has("stop")) {
      player.order = null;
      player.chase = false;
      if (caster) caster.target = null;
    }
    const moving = input.move.x !== 0 || input.move.z !== 0;
    // A new right-click replaces an attack move; one still held from before doesn't (pressing S
    // while steering, then letting go, must keep it armed).
    const freshCommand = command !== null && player.click === null;
    if (input.pressed.has("stop") || moving || freshCommand) player.attackMove = null;
    if (caster) {
      if (moving || (input.pressed.has("primary") && !hovered)) {
        caster.target = null;
        player.chase = false;
      }
      if (input.held.has("primary") && hovered) {
        caster.target = hovered.uid;
        player.chase = command !== null;
      }
      castModes(world, entity, dt, input, moving || freshCommand);
    }
    if (moving) {
      player.order = null;
    } else if (command && hovered && caster) {
      // An attack order: the chase below walks it into range.
      caster.target = hovered.uid;
      player.chase = true;
    } else if (command) {
      if (caster) caster.target = null;
      player.chase = false;
      const fresh = player.click === null;
      if (fresh) player.orders++;
      const last = player.click;
      if (fresh || !last || last.x !== command.x || last.z !== command.z) {
        player.order = order(world, stats.radius, position, command);
      }
    }
    player.click = command ? { x: command.x, z: command.z } : null;
    attackMove(world, entity, input, stats.radius);
    chase(world, entity, stats.radius);

    mover.desired.x = moving ? input.move.x * stats.speed : 0;
    mover.desired.z = moving ? input.move.z * stats.speed : 0;
    const current = player.order;
    if (!current) continue;

    // Corners within a tick's travel are passed.
    const waypoints = current.waypoints;
    while (waypoints.length > 1 && distance(position, waypoints[0] as Vec2) <= stats.speed * dt) {
      waypoints.shift();
    }
    const target = waypoints[0];
    if (!target) {
      player.order = null;
      continue;
    }
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const d = dmath.hypot(dx, dz);
    let want = stats.speed;
    if (waypoints.length === 1) {
      want = Math.min(want, Math.sqrt(2 * stats.decel * d));
      const speed = dmath.hypot(mover.velocity.x, mover.velocity.z);
      // Within this tick's travel: land on the goal and stop. Otherwise this tick can't pass it.
      if (d <= Math.max(want, speed) * dt) {
        position.x = target.x;
        position.z = target.z;
        mover.velocity.x = 0;
        mover.velocity.z = 0;
        player.order = null;
        continue;
      }
    }
    mover.desired.x = (dx / d) * want;
    mover.desired.z = (dz / d) * want;

    if (debugDraw.enabled) {
      debugDraw.path([position, ...waypoints], { color: "magenta", category: "path" });
      debugDraw.circle(current.goal, 0.2, { color: "magenta", category: "path" });
    }
  }
}

/** Arms, issues and follows moba's attack move (see `playerControlSystem`). */
function attackMove(world: World<Entity>, entity: Entity, input: InputFrame, radius: number) {
  const { player, caster, transform } = entity;
  if (!player || !caster || !transform) return;
  if (input.pressed.has("attackMove")) {
    player.attackMove = { armed: true, point: null, origin: null, casts: caster.casts };
    disarmAiming(entity);
  }
  const move = player.attackMove;
  if (!move) return;

  if (move.armed) {
    if (!input.pressed.has("confirm")) return;
    move.armed = false;
    move.casts = caster.casts;
    // An attack move is a new order: it drops a walk into range.
    dropChase(entity);
    const hovered = enemyOf(world, entity, input.hover);
    if (hovered) {
      caster.target = hovered.uid;
      player.chase = true;
      player.order = null;
      return;
    }
    const click = { x: input.aim.x, z: input.aim.z };
    move.point = click;
    move.origin = { x: transform.position.x, z: transform.position.z };
    // An enemy it would pick up right away is picked now, so attack-moving again while attacking
    // it keeps the attack going (dropping the target for a tick would cancel the windup).
    const enemy = onTheWay(world, entity, move, radius);
    if (enemy) {
      caster.target = enemy.uid;
      player.chase = true;
      player.order = null;
      move.point = null;
      return;
    }
    caster.target = null;
    player.chase = false;
    player.order = order(world, radius, transform.position, click);
    return;
  }

  // Issued: over once an attack starts, or when there's nothing left to go for.
  if (caster.casts !== move.casts) {
    player.attackMove = null;
    return;
  }
  if (!move.point) {
    if (caster.target === null) player.attackMove = null;
    return;
  }
  const enemy = onTheWay(world, entity, move, radius);
  if (enemy) {
    caster.target = enemy.uid;
    player.chase = true;
    player.order = null;
    move.point = null;
  } else if (!player.order) {
    // Arrived with nobody around.
    player.attackMove = null;
  }
}

/**
 * The enemy an issued attack move walking to `move.point` picks up where the body stands: the
 * nearest within the acquire distance. Enemies that were already this near when the move was
 * issued are the ones you're leaving and don't count, unless the click is this near them too
 * (you're not leaving them).
 */
function onTheWay(
  world: World<Entity>,
  entity: Entity,
  move: AttackMove,
  radius: number,
): Targetable | undefined {
  const { transform } = entity;
  const { origin, point } = move;
  if (!transform || !point) return undefined;
  const near = radius + ATTACK_MOVE.acquire;
  return nearestEnemy(
    world,
    entity,
    transform.position,
    near,
    (target) =>
      origin !== null && gapFromPoint(origin, target) <= near && gapFromPoint(point, target) > near,
  );
}

/**
 * The ability keys' cast modes (League's), for every slot but the auto attack's:
 * - quick cast (the key alone): queue the cast at the cursor and the hovered body
 * - normal cast (the key with `normalCast`, Shift): arm `player.aiming` if the slot could start
 *   now, else wait up to `abilities.buffer` seconds to arm (`player.aimQueued`); a left click
 *   (`confirm`) then queues it like a quick cast at that tick's cursor. A right-click (a move or
 *   attack order, still carried out), stop, Esc (`pause`), the attack move, or another ability key
 *   cancel it (that key's own mode then applies). Abilities aimed at `self` just cast.
 * - self cast (the key with `selfCast`, Alt): a cast on the caster for abilities with `selfCast`,
 *   else a quick cast.
 * A queued cast walking into range (`queued.chase`) is dropped by a move or attack order, stop or
 * another ability key. Arming and cancelling never spend a cooldown.
 */
function castModes(
  world: World<Entity>,
  entity: Entity,
  dt: number,
  input: InputFrame,
  ordered: boolean,
): void {
  const { player, caster, transform } = entity;
  if (!player || !caster || !transform) return;
  const pressed = input.pressed;
  const newOrder = ordered || pressed.has("primary");
  if (newOrder || pressed.has("stop") || pressed.has("attackMove") || pressed.has("pause")) {
    disarmAiming(entity);
  }
  if (newOrder || pressed.has("stop")) dropChase(entity);

  for (const slot of SLOTS) {
    if (slot === "primary" || !pressed.has(slot)) continue;
    const def = slotAbility(entity, slot);
    // An empty slot's key does nothing (it doesn't cancel anything either).
    if (!def) continue;
    disarmAiming(entity);
    dropChase(entity);
    if (pressed.has("normalCast") && def.aim !== "self") {
      if (canStart(entity, slot)) arm(entity, slot);
      else player.aimQueued = { slot, age: 0 };
    } else if (pressed.has("selfCast") && def.selfCast && entity.uid !== undefined) {
      // Aimed at the caster itself, which `casting` resolves as a self cast.
      const at = transform.position;
      caster.queued = { slot, age: 0, point: { x: at.x, z: at.z }, target: entity.uid };
    } else {
      queueCast(world, entity, slot, def, input);
    }
  }

  const waiting = player.aimQueued;
  if (waiting) {
    if (canStart(entity, waiting.slot)) {
      delete player.aimQueued;
      arm(entity, waiting.slot);
    } else {
      waiting.age += dt;
      if (waiting.age > ABILITIES.buffer + EPSILON) delete player.aimQueued;
    }
  }

  const aiming = player.aiming;
  if (aiming && pressed.has("confirm")) {
    delete player.aiming;
    const def = slotAbility(entity, aiming.slot);
    if (def) queueCast(world, entity, aiming.slot, def, input);
  }
}

/** Queues a cast of `slot` at the cursor and the hovered body; a targeted one on an enemy out of
 * range walks into range first (`chase`). */
function queueCast(
  world: World<Entity>,
  entity: Entity,
  slot: SlotId,
  def: AbilityDef,
  input: InputFrame,
): void {
  const { caster } = entity;
  if (!caster) return;
  const queued: QueuedCast = { slot, age: 0, point: { ...input.aim }, target: input.hover };
  if (def.aim === "target") {
    const target = enemyOf(world, entity, input.hover);
    if (target && !inRange(entity, target, def.stats(entity).range)) queued.chase = true;
  }
  caster.queued = queued;
}

/** Starts aiming a normal cast of `slot`; an armed attack move is disarmed. */
function arm(entity: Entity, slot: SlotId): void {
  const { player } = entity;
  if (!player) return;
  player.aiming = { slot };
  if (player.attackMove?.armed) player.attackMove = null;
}

/** Drops a queued cast that's walking into range, and the walk (a plain buffered press stays). */
function dropChase(entity: Entity): void {
  const { player, caster } = entity;
  if (!player || !caster?.queued?.chase) return;
  caster.queued = null;
  player.order = null;
}

/** Stops aiming a normal cast, and drops one waiting to arm. */
function disarmAiming(entity: Entity): void {
  const { player } = entity;
  if (!player) return;
  delete player.aiming;
  delete player.aimQueued;
}

/** Whether `slot` can be aimed now: it has an ability and it's off cooldown (or cooldowns are off).
 * A running cast doesn't stop the aiming (it's only UI, like League's targeting during an auto
 * attack): the confirm queues the cast, which starts once that one is over. */
function canStart(entity: Entity, slot: SlotId): boolean {
  const caster = entity.caster;
  const state = caster?.slots[slot];
  if (!caster || !state || !slotAbility(entity, slot)) return false;
  return entity.noCooldowns === true || state.cooldown <= EPSILON;
}

/** The ability in `slot`, if any. */
function slotAbility(entity: Entity, slot: SlotId): AbilityDef | undefined {
  const state = entity.caster?.slots[slot];
  return state ? abilityById(state.ability) : undefined;
}

/**
 * Walks into range: a queued targeted cast out of range (`queued.chase`) and else moba's attack
 * order. While the target is out of range, walk a path to it (repathing as it moves); once in
 * range, stop and let `casting` cast or attack. A cast whose target is gone is dropped.
 */
function chase(world: World<Entity>, entity: Entity, radius: number): void {
  const { player, caster, transform } = entity;
  if (!player || !caster || !transform) return;
  const queued = caster.queued;
  if (queued?.chase) {
    const target = enemyOf(world, entity, queued.target);
    const def = slotAbility(entity, queued.slot);
    if (target && def) {
      walkInto(world, entity, target, def.stats(entity).range, radius);
      return;
    }
    dropChase(entity);
  }
  if (!player.chase) return;
  const target = enemyOf(world, entity, caster.target);
  const range = primaryRange(entity);
  if (!target || range === null) {
    player.chase = false;
    return;
  }
  walkInto(world, entity, target, range, radius);
}

/** Paths toward `target` until it's within `range`, then stops. */
function walkInto(
  world: World<Entity>,
  entity: Entity,
  target: Targetable,
  range: number,
  radius: number,
): void {
  const { player, transform } = entity;
  if (!player || !transform) return;
  if (inRange(entity, target, range)) {
    player.order = null;
    return;
  }
  const at = target.transform.position;
  const goal = player.order?.goal;
  if (!goal || distance(goal, at) > CHASE_REPATH) {
    player.order = order(world, radius, transform.position, { x: at.x, z: at.z });
  }
  if (debugDraw.enabled) drawChase(transform.position, target);
}

/** The range of the auto attack in the primary slot, if it's a targeted one. */
function primaryRange(entity: Entity): number | null {
  const slot = entity.caster?.slots.primary;
  const def = slot && abilityById(slot.ability);
  return def?.aim === "target" ? def.stats(entity).range : null;
}

function drawChase(from: Vec2, target: Targetable): void {
  debugDraw.line(from, target.transform.position, { color: "red", category: "path" });
}

/** The order for a move command to `click`: the path there (or as close as it gets). */
function order(world: World<Entity>, radius: number, from: Vec2, click: Vec2): MoveOrder {
  const graph = navGraphOf(world, radius);
  if (!graph) return { goal: { x: click.x, z: click.z }, waypoints: [{ x: click.x, z: click.z }] };
  return findPath(graph, { x: from.x, z: from.z }, click);
}

const distance = (a: Vec2, b: Vec2) => dmath.hypot(b.x - a.x, b.z - a.z);
