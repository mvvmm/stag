import type { World } from "miniplex";
import { enemyOf, inRange, nearestEnemy, type Targetable } from "@/combat/abilities";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import type { Rng } from "@/core/rng";
import { defineTunables } from "@/core/tuning";
import { abilityById } from "@/data/abilities";
import { type Entity, type MoveOrder, SLOTS } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { navGraphOf } from "@/nav/graph";
import { findPath } from "@/nav/path";
import { movementStats } from "@/systems/movementStats";

/** A chase repaths once its target is this far (m) from where the path ends. */
const CHASE_REPATH = 0.25;

/** moba's attack move (S, then left click), League-style. */
export const ATTACK_MOVE = defineTunables("attackMove", {
  /** The click goes for the enemy nearest it, if that enemy's body is within this of it, m. */
  radius: { value: 3, min: 0, max: 20, step: 0.1 },
  /** Otherwise the cat walks to the click and goes for the first enemy that comes within this of
   * its body (edge to edge), m. */
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
 *   left click (`confirm`) issues it: chase the enemy nearest the click, or with none near it walk
 *   there and go for the first enemy that comes near on the way. It's over once an attack starts;
 *   stop, a new right-click or moving drop it (a right-click still held from before doesn't).
 * - Ability keys queue a cast at the cursor (`caster.queued`), for `casting` to start when it can.
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
      for (const slot of SLOTS) {
        if (slot === "primary" || !input.pressed.has(slot) || !caster.slots[slot]) continue;
        caster.queued = { slot, age: 0, point: { ...input.aim }, target: input.hover };
      }
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
    player.attackMove = { armed: true, point: null, casts: caster.casts };
  }
  const move = player.attackMove;
  if (!move) return;

  if (move.armed) {
    if (!input.pressed.has("confirm")) return;
    move.armed = false;
    move.casts = caster.casts;
    const click = { x: input.aim.x, z: input.aim.z };
    const enemy = nearestEnemy(world, entity, click, ATTACK_MOVE.radius);
    if (enemy) {
      caster.target = enemy.uid;
      player.chase = true;
      player.order = null;
      return;
    }
    caster.target = null;
    player.chase = false;
    move.point = click;
    player.order = order(world, radius, transform.position, click);
    player.orders++;
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
  const enemy = nearestEnemy(world, entity, transform.position, radius + ATTACK_MOVE.acquire);
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
 * moba's attack order: while the target is out of the auto attack's range, walk a path to it
 * (repathing as it moves); once in range, stop and let `casting` attack.
 */
function chase(world: World<Entity>, entity: Entity, radius: number): void {
  const { player, caster, transform } = entity;
  if (!player?.chase || !caster || !transform) return;
  const target = enemyOf(world, entity, caster.target);
  const range = primaryRange(entity);
  if (!target || range === null) {
    player.chase = false;
    return;
  }
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
