import type { World } from "miniplex";
import type { Vec2 } from "@/core/math";
import { distanceToShape, type ObstacleShape, shapeBounds } from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";

// The nav grid: the room's inner area in square cells, each blocked or walkable for a body of
// radius `pad`. Derived from the obstacle entities, never simulation state: it's cached per world
// and rebuilt when the radius changes, so a snapshot restore rebuilds it identically.

export const NAV_CELL = 0.25;

export type NavGrid = {
  cell: number;
  cols: number;
  rows: number;
  /** World position of the grid's min corner (cell 0's outer corner). */
  minX: number;
  minZ: number;
  /** 1 where a body of radius `pad` doesn't fit (its center would be inside a grown obstacle). */
  blocked: Uint8Array;
  shapes: readonly ObstacleShape[];
  pad: number;
};

type Area = { width: number; depth: number };

/** Rasterizes `shapes` grown by `pad` over a `width` × `depth` room centered on the origin. */
export function buildNavGrid(
  area: Area,
  shapes: readonly ObstacleShape[],
  pad: number,
  cell = NAV_CELL,
): NavGrid {
  const cols = Math.ceil(area.width / cell);
  const rows = Math.ceil(area.depth / cell);
  const grid: NavGrid = {
    cell,
    cols,
    rows,
    minX: -(cols * cell) / 2,
    minZ: -(rows * cell) / 2,
    blocked: new Uint8Array(cols * rows),
    shapes,
    pad,
  };
  for (const shape of shapes) {
    const bounds = shapeBounds(shape);
    const [c0, r0] = cellCoords(grid, { x: bounds.minX - pad, z: bounds.minZ - pad });
    const [c1, r1] = cellCoords(grid, { x: bounds.maxX + pad, z: bounds.maxZ + pad });
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const index = r * cols + c;
        if (grid.blocked[index]) continue;
        if (distanceToShape(cellCenter(grid, index), shape) < pad) grid.blocked[index] = 1;
      }
    }
  }
  // Cells whose center is closer than `pad` to the room's edge are blocked too (a room without
  // perimeter walls still keeps bodies inside).
  const halfW = area.width / 2 - pad;
  const halfD = area.depth / 2 - pad;
  for (let index = 0; index < cols * rows; index++) {
    const center = cellCenter(grid, index);
    if (Math.abs(center.x) > halfW || Math.abs(center.z) > halfD) grid.blocked[index] = 1;
  }
  return grid;
}

/** Column and row of the cell containing `p` (may be outside the grid). */
export function cellCoords(grid: NavGrid, p: Vec2): [number, number] {
  return [Math.floor((p.x - grid.minX) / grid.cell), Math.floor((p.z - grid.minZ) / grid.cell)];
}

/** The index of the cell containing `p`, clamped onto the grid. */
export function cellIndex(grid: NavGrid, p: Vec2): number {
  const [c, r] = cellCoords(grid, p);
  const col = Math.min(grid.cols - 1, Math.max(0, c));
  const row = Math.min(grid.rows - 1, Math.max(0, r));
  return row * grid.cols + col;
}

export function cellCenter(grid: NavGrid, index: number): Vec2 {
  const col = index % grid.cols;
  const row = (index - col) / grid.cols;
  return { x: grid.minX + (col + 0.5) * grid.cell, z: grid.minZ + (row + 0.5) * grid.cell };
}

/** The walkable cell closest to `index` (itself if walkable), searching outward ring by ring. */
export function nearestFreeCell(grid: NavGrid, index: number): number | null {
  if (!grid.blocked[index]) return index;
  const col = index % grid.cols;
  const row = (index - col) / grid.cols;
  const from = cellCenter(grid, index);
  const maxRing = Math.max(grid.cols, grid.rows);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= maxRing; ring++) {
    // A ring's cells are at least `ring` cells away, so once that's past the best, it's the closest.
    const ringDistance = ring * grid.cell;
    if (ringDistance * ringDistance > bestDistance) break;
    for (let r = row - ring; r <= row + ring; r++) {
      if (r < 0 || r >= grid.rows) continue;
      for (let c = col - ring; c <= col + ring; c++) {
        if (c < 0 || c >= grid.cols) continue;
        // Only the ring's outline.
        if (r !== row - ring && r !== row + ring && c !== col - ring && c !== col + ring) continue;
        const candidate = r * grid.cols + c;
        if (grid.blocked[candidate]) continue;
        const center = cellCenter(grid, candidate);
        const dx = center.x - from.x;
        const dz = center.z - from.z;
        const distance = dx * dx + dz * dz;
        // Ties go to the lower index (the scan order), so the result is deterministic.
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
  }
  return best;
}

const cache = new WeakMap<World<Entity>, NavGrid>();

/**
 * The world's nav grid for bodies of radius `pad`, built from its `room` and `obstacle` entities on
 * first use and again when `pad` changes. Null without a room. Editing an obstacle later doesn't
 * rebuild it (that waits for a room editor).
 */
export function navGridOf(world: World<Entity>, pad: number): NavGrid | null {
  const cached = cache.get(world);
  if (cached && cached.pad === pad) return cached;
  const room = world.with("room").first?.room;
  if (!room) return null;
  const shapes = [...world.with("obstacle")].map((entity) => entity.obstacle.shape);
  const grid = buildNavGrid(room, shapes, pad);
  cache.set(world, grid);
  return grid;
}
