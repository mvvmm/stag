import type { World } from "miniplex";
import { debugDraw } from "@/core/debugDraw";
import { dmath } from "@/core/dmath";
import type { Vec2 } from "@/core/math";
import type { Rng } from "@/core/rng";
import type { Entity, MoveOrder } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { cellIndex, navGridOf } from "@/nav/grid";
import { findPath, resolveGoal } from "@/nav/path";
import { movementStats } from "@/systems/movementStats";

/**
 * Turns input into the player's desired velocity for `locomotion`:
 * - WASD asks for `move · speed` and drops any click-to-move order.
 * - A move command (right-click) paths around obstacles to the cursor. Holding the button steers:
 *   it repaths when the cursor moves to another nav cell, and within a cell it only moves the goal.
 * - Following an order runs at full speed through the corners and brakes on the last leg just in
 *   time (`√(2·decel·distance)`) to land on the goal, where it stops dead.
 * - `stop` drops the order, so the player brakes.
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

    if (input.pressed.has("stop")) player.order = null;
    const moving = input.move.x !== 0 || input.move.z !== 0;
    if (moving) {
      player.order = null;
    } else if (command) {
      const fresh = player.click === null;
      if (fresh) player.orders++;
      const last = player.click;
      if (fresh || !last || last.x !== command.x || last.z !== command.z) {
        player.order = order(
          world,
          stats.radius,
          position,
          command,
          fresh ? null : last,
          player.order,
        );
      }
    }
    player.click = command ? { x: command.x, z: command.z } : null;

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

/**
 * The order for a move command to `click`. A held button that stays in the same nav cell only moves
 * the end of the current path; anything else paths from scratch.
 */
function order(
  world: World<Entity>,
  radius: number,
  from: Vec2,
  click: Vec2,
  held: Vec2 | null,
  current: MoveOrder | null,
): MoveOrder {
  const grid = navGridOf(world, radius);
  if (!grid) return { goal: { x: click.x, z: click.z }, waypoints: [{ x: click.x, z: click.z }] };
  if (held && current && cellIndex(grid, held) === cellIndex(grid, click)) {
    const goal = resolveGoal(grid, click);
    current.waypoints[current.waypoints.length - 1] = goal;
    return { goal: { ...goal }, waypoints: current.waypoints };
  }
  return findPath(grid, { x: from.x, z: from.z }, click);
}

const distance = (a: Vec2, b: Vec2) => dmath.hypot(b.x - a.x, b.z - a.z);
