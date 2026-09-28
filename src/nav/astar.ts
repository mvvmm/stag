// A* over any graph of numbered nodes. Every tie is broken the same way (lowest f, then highest g,
// then lowest node), so the same graph always gives the same path.

export type AstarGraph = {
  /** Calls `visit` for every edge leaving `node`, with its cost. */
  neighbors(node: number, visit: (to: number, cost: number) => void): void;
  /** An estimate of the cost from `node` to the goal that never overestimates. */
  heuristic(node: number): number;
};

export type AstarResult = {
  /** Nodes from the start to the goal, both included; null if the goal can't be reached. */
  path: number[] | null;
  /** Every node whose shortest cost was settled (the reachable set, when the goal wasn't found). */
  settled: number[];
  /** The node each settled node was reached from (-1 for the start). */
  parent: Map<number, number>;
};

export function astar(graph: AstarGraph, start: number, goal: number): AstarResult {
  const g = new Map<number, number>([[start, 0]]);
  const f = new Map<number, number>([[start, graph.heuristic(start)]]);
  const parent = new Map<number, number>([[start, -1]]);
  const closed = new Set<number>();
  const settled: number[] = [];

  // Binary min-heap of nodes; a node can be in it more than once (stale entries are skipped).
  const heap: number[] = [];
  const heapF: number[] = [];
  const heapG: number[] = [];
  const before = (a: number, b: number) =>
    heapF[a] !== heapF[b]
      ? (heapF[a] as number) < (heapF[b] as number)
      : heapG[a] !== heapG[b]
        ? (heapG[a] as number) > (heapG[b] as number)
        : (heap[a] as number) < (heap[b] as number);
  const swap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b] as number, heap[a] as number];
    [heapF[a], heapF[b]] = [heapF[b] as number, heapF[a] as number];
    [heapG[a], heapG[b]] = [heapG[b] as number, heapG[a] as number];
  };
  const push = (node: number, nodeF: number, nodeG: number) => {
    heap.push(node);
    heapF.push(nodeF);
    heapG.push(nodeG);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!before(i, up)) break;
      swap(i, up);
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const node = heap[0] as number;
    const nodeG = heapG[0] as number;
    const last = heap.length - 1;
    swap(0, last);
    heap.pop();
    heapF.pop();
    heapG.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < heap.length && before(l, best)) best = l;
      if (r < heap.length && before(r, best)) best = r;
      if (best === i) break;
      swap(i, best);
      i = best;
    }
    return [node, nodeG];
  };

  push(start, f.get(start) as number, 0);
  while (heap.length) {
    const [node, nodeG] = pop();
    if (closed.has(node) || nodeG !== g.get(node)) continue;
    closed.add(node);
    settled.push(node);
    if (node === goal) break;
    graph.neighbors(node, (to, cost) => {
      if (closed.has(to)) return;
      const tentative = nodeG + cost;
      const known = g.get(to);
      if (known !== undefined && tentative >= known) return;
      g.set(to, tentative);
      parent.set(to, node);
      const toF = tentative + graph.heuristic(to);
      f.set(to, toF);
      push(to, toF, tentative);
    });
  }

  return { path: closed.has(goal) ? pathTo(parent, goal) : null, settled, parent };
}

/** The nodes from the start to `node`, following `parent`. */
export function pathTo(parent: Map<number, number>, node: number): number[] {
  const path: number[] = [];
  for (let at = node; at !== -1; at = parent.get(at) as number) path.push(at);
  return path.reverse();
}
