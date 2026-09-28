import type { Vec2 } from "@/core/math";
import { astar } from "@/nav/astar";
import { cellCenter, cellIndex, type NavGrid, nearestFreeCell } from "@/nav/grid";
import { insidePadded, pushOut, segmentClear } from "@/nav/shapes";

/** Extra room kept between a resolved goal and the obstacle it was pushed out of. */
const GOAL_SKIN = 0.02;

export type NavPath = {
  /** Where the path ends: the requested point, or the closest reachable point to it. */
  goal: Vec2;
  /** Corners to walk through after `from`, ending with `goal`. */
  waypoints: Vec2[];
};

/** Whether a body of the grid's radius standing at `p` touches nothing and is inside the room. */
export function isFree(grid: NavGrid, p: Vec2): boolean {
  if (
    p.x < grid.minX + grid.pad ||
    p.x > -grid.minX - grid.pad ||
    p.z < grid.minZ + grid.pad ||
    p.z > -grid.minZ - grid.pad
  ) {
    return false;
  }
  return grid.shapes.every((shape) => !insidePadded(p, shape, grid.pad));
}

/** Whether a body of the grid's radius can walk straight from `a` to `b`. */
export function lineClear(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  return grid.shapes.every((shape) => segmentClear(a, b, shape, grid.pad));
}

/**
 * Where a body asked to go to `p` should stand: `p` itself if it fits there, else pushed into the
 * room and out of the obstacles it's in, else the nearest walkable cell's center.
 */
export function resolveGoal(grid: NavGrid, p: Vec2): Vec2 {
  if (isFree(grid, p)) return { x: p.x, z: p.z };
  const margin = grid.pad + GOAL_SKIN;
  let goal = {
    x: Math.min(-grid.minX - margin, Math.max(grid.minX + margin, p.x)),
    z: Math.min(-grid.minZ - margin, Math.max(grid.minZ + margin, p.z)),
  };
  for (const shape of grid.shapes) {
    if (insidePadded(goal, shape, grid.pad)) goal = pushOut(goal, shape, margin);
  }
  if (isFree(grid, goal)) return goal;
  const cell = nearestFreeCell(grid, cellIndex(grid, p));
  return cell === null ? goal : cellCenter(grid, cell);
}

/**
 * A walkable path from `from` toward `to`: A* over the grid, then pulled tight by line of sight so
 * it runs at any angle and turns at obstacle corners. `from` may be inside an obstacle (before
 * collision, WASD can walk into one); the path then leads out of it first.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): NavPath {
  let goal = resolveGoal(grid, to);
  const startCell = nearestFreeCell(grid, cellIndex(grid, from));
  const goalCell = nearestFreeCell(grid, cellIndex(grid, goal));
  if (startCell === null || goalCell === null) return { goal: { ...from }, waypoints: [] };

  const cells = astar(grid, startCell, goalCell);
  const reached = cells[cells.length - 1] as number;
  // Unreachable: stop at the closest cell A* got to instead.
  if (reached !== goalCell) goal = cellCenter(grid, reached);

  // from, the cell centers in between, goal. The start and goal cells are left out: `from` and
  // `goal` lie in (or right next to) them.
  const points: Vec2[] = [from, ...cells.slice(1, -1).map((cell) => cellCenter(grid, cell)), goal];

  // String pulling: from each corner, walk ahead while the next point is still in sight.
  const waypoints: Vec2[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    while (
      next + 1 < points.length &&
      lineClear(grid, points[anchor] as Vec2, points[next + 1] as Vec2)
    ) {
      next++;
    }
    waypoints.push(points[next] as Vec2);
    anchor = next;
  }
  // Its own copy: the path is stored as plain data, where shared objects would alias.
  return { goal: { ...goal }, waypoints };
}
