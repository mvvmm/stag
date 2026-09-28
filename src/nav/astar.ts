import type { NavGrid } from "@/nav/grid";

// A* over the nav grid: 8-connected, no cutting past a blocked corner, octile distances. Every
// tie is broken the same way (lowest f, then highest g, then lowest cell index), so the same grid
// and cells always give the same path.

const DIAGONAL = Math.SQRT2;

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Cells from `start` to `goal` (both included). If the goal can't be reached, the path ends at the
 * reached cell closest to it. `start` must be walkable.
 */
export function astar(grid: NavGrid, start: number, goal: number): number[] {
  const { cols, rows, blocked } = grid;
  const size = cols * rows;
  const g = new Float64Array(size).fill(Infinity);
  const f = new Float64Array(size);
  const from = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const goalCol = goal % cols;
  const goalRow = (goal - goalCol) / cols;
  const heuristic = (index: number) => {
    const col = index % cols;
    const dx = Math.abs(col - goalCol);
    const dz = Math.abs((index - col) / cols - goalRow);
    return dx + dz + (DIAGONAL - 2) * Math.min(dx, dz);
  };

  // Binary min-heap of cell indices.
  const heap: number[] = [];
  const before = (a: number, b: number) => {
    const fa = f[a] as number;
    const fb = f[b] as number;
    if (fa !== fb) return fa < fb;
    const ga = g[a] as number;
    const gb = g[b] as number;
    if (ga !== gb) return ga > gb;
    return a < b;
  };
  const push = (index: number) => {
    heap.push(index);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i] as number, heap[parent] as number)) break;
      [heap[i], heap[parent]] = [heap[parent] as number, heap[i] as number];
      i = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && before(heap[left] as number, heap[smallest] as number)) {
          smallest = left;
        }
        if (right < heap.length && before(heap[right] as number, heap[smallest] as number)) {
          smallest = right;
        }
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest] as number, heap[i] as number];
        i = smallest;
      }
    }
    return top;
  };

  g[start] = 0;
  f[start] = heuristic(start);
  push(start);
  let closest = start;
  let closestH = f[start] as number;

  while (heap.length) {
    const current = pop();
    if (closed[current]) continue; // a stale heap entry
    closed[current] = 1;
    if (current === goal) {
      closest = goal;
      break;
    }
    const h = (f[current] as number) - (g[current] as number);
    if (h < closestH || (h === closestH && current < closest)) {
      closest = current;
      closestH = h;
    }
    const col = current % cols;
    const row = (current - col) / cols;
    for (const [dc, dr] of NEIGHBORS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const next = r * cols + c;
      if (blocked[next] || closed[next]) continue;
      const diagonal = dc !== 0 && dr !== 0;
      // No squeezing diagonally past a blocked corner.
      if (diagonal && (blocked[row * cols + c] || blocked[r * cols + col])) continue;
      const cost = (g[current] as number) + (diagonal ? DIAGONAL : 1);
      if (cost >= (g[next] as number)) continue;
      g[next] = cost;
      f[next] = cost + heuristic(next);
      from[next] = current;
      push(next);
    }
  }

  const path: number[] = [];
  for (let at = closest; at !== -1; at = from[at] as number) path.push(at);
  return path.reverse();
}
