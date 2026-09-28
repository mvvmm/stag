import { moveAndSlide } from "@/collision/slide";
import { dmath } from "@/core/dmath";
import { TAU, type Vec2 } from "@/core/math";
import { distanceToShape } from "@/data/rooms/room";
import { astar, pathTo } from "@/nav/astar";
import {
  angleOn,
  arcDelta,
  arcFree,
  type NavCircle,
  type NavGraph,
  orientation,
  pointFree,
  ringOf,
  segmentFree,
  tangentsFrom,
} from "@/nav/graph";
import { pushOut } from "@/nav/shapes";

/** Extra room kept between a resolved goal and the obstacle it was pushed out of. */
const GOAL_SKIN = 0.02;
/** How far a path's arcs may bulge outside their circle, m (they're walked as short straights). */
const ARC_BULGE = 0.001;
/** Reachable nodes (closest to an unreachable goal first) tried for getting as close as possible. */
const FALLBACK_CANDIDATES = 16;

export type NavPath = {
  /** Where the path ends: the requested point, or the closest reachable point to it. */
  goal: Vec2;
  /** Corners to walk through after `from`, ending with `goal`. */
  waypoints: Vec2[];
};

/** Whether a body of the graph's radius standing at `p` touches nothing and is inside the room. */
export function isFree(graph: NavGraph, p: Vec2): boolean {
  return pointFree(graph, p);
}

/** Whether a body of the graph's radius can walk straight from `a` to `b`. */
export function lineClear(graph: NavGraph, a: Vec2, b: Vec2): boolean {
  return segmentFree(graph, a, b);
}

/**
 * Where a body asked to go to `p` should stand: `p` itself if it fits there, else pushed into the
 * room and out of the obstacles it's in, else the closest free point around it.
 */
export function resolveGoal(graph: NavGraph, p: Vec2): Vec2 {
  if (isFree(graph, p)) return { x: p.x, z: p.z };
  const margin = graph.pad + GOAL_SKIN;
  let goal = {
    x: Math.min(graph.halfW - margin, Math.max(-graph.halfW + margin, p.x)),
    z: Math.min(graph.halfD - margin, Math.max(-graph.halfD + margin, p.z)),
  };
  for (let pass = 0; pass < 3; pass++) {
    for (const shape of graph.shapes) {
      if (distanceToShape(goal, shape) < graph.pad) goal = pushOut(goal, shape, margin);
    }
  }
  if (isFree(graph, goal)) return goal;
  // Wedged between shapes: the first free point on rings of growing radius around the click.
  const limit = 2 * dmath.hypot(graph.halfW, graph.halfD);
  for (let r = 0.1; r < limit; r += 0.1) {
    const count = Math.max(8, Math.ceil((TAU * r) / 0.1));
    for (let i = 0; i < count; i++) {
      const angle = (TAU * i) / count;
      const q = { x: p.x + r * dmath.cos(angle), z: p.z + r * dmath.sin(angle) };
      if (isFree(graph, q)) return q;
    }
  }
  return goal;
}

/** A node added for one query: a tangent point from the start or to the goal. */
type Temp = { circle: number; x: number; z: number; angle: number; orient: number; start: boolean };
type Edge = { to: number; cost: number };

/**
 * The shortest walkable path from `from` toward `to`, exact against the grown shapes: straight
 * tangent lines and arcs round circles, so it fits every gap a body of the graph's radius fits.
 * `from` may be inside an obstacle; the path then leads out of it first.
 */
export function findPath(graph: NavGraph, from: Vec2, to: Vec2): NavPath {
  let goal = resolveGoal(graph, to);
  const start = isFree(graph, from) ? { x: from.x, z: from.z } : resolveGoal(graph, from);
  const lead = start.x === from.x && start.z === from.z ? [] : [{ ...start }];
  if (lineClear(graph, start, goal)) return finish(goal, [...lead, goal]);

  const nodes = graph.nodeCircle.length;
  const S = nodes;
  const G = nodes + 1;
  const temps: Temp[] = [];
  graph.circles.forEach((c, circle) => {
    for (const [p, start_] of [
      [start, true],
      [goal, false],
    ] as const) {
      for (const t of tangentsFrom(p, c)) {
        const dx = start_ ? t.x - p.x : p.x - t.x;
        const dz = start_ ? t.z - p.z : p.z - t.z;
        const degenerate = dx === 0 && dz === 0;
        if (!degenerate && !segmentFree(graph, p, t)) continue;
        for (const orient of degenerate ? [1, -1] : [orientation(c, t, dx, dz)]) {
          temps.push({ circle, x: t.x, z: t.z, angle: angleOn(c, t), orient, start: start_ });
        }
      }
    }
  });

  // Arcs that begin or end at a temp node: a start temp to the next node round its circle (and to
  // any goal temp before that), the node before each goal temp to it.
  const extra = new Map<number, Edge[]>();
  const addEdge = (from_: number, edge: Edge) => {
    const list = extra.get(from_);
    if (list) list.push(edge);
    else extra.set(from_, [edge]);
  };
  temps.forEach((t, i) => {
    const c = graph.circles[t.circle] as NavCircle;
    const id = G + 1 + i;
    const ring = graph.rings[ringOf(t.circle, t.orient)] as number[];
    if (t.start) {
      const next = neighbour(graph, ring, t.angle, t.orient, true);
      let reach = Infinity;
      if (next !== -1) {
        const delta = arcDelta(t.angle, graph.nodeAngle[next] as number, t.orient);
        reach = delta;
        if (arcFree(c, t.angle, t.orient, delta)) addEdge(id, { to: next, cost: c.r * delta });
      }
      temps.forEach((u, j) => {
        if (u.start || u.circle !== t.circle || u.orient !== t.orient) return;
        const delta = arcDelta(t.angle, u.angle, t.orient);
        if (delta <= reach && arcFree(c, t.angle, t.orient, delta)) {
          addEdge(id, { to: G + 1 + j, cost: c.r * delta });
        }
      });
    } else {
      const previous = neighbour(graph, ring, t.angle, t.orient, false);
      if (previous === -1) return;
      const from_ = graph.nodeAngle[previous] as number;
      const delta = arcDelta(from_, t.angle, t.orient);
      if (arcFree(c, from_, t.orient, delta)) addEdge(previous, { to: id, cost: c.r * delta });
    }
  });

  const pointOf = (node: number): Vec2 => {
    if (node === S) return start;
    if (node === G) return goal;
    if (node > G) {
      const t = temps[node - G - 1] as Temp;
      return { x: t.x, z: t.z };
    }
    return { x: graph.nodeX[node] as number, z: graph.nodeZ[node] as number };
  };
  const distance = (a: Vec2, b: Vec2) => dmath.hypot(b.x - a.x, b.z - a.z);

  const result = astar(
    {
      neighbors(node, visit) {
        if (node === S) {
          temps.forEach((t, i) => {
            if (t.start) visit(G + 1 + i, distance(start, t));
          });
          return;
        }
        if (node > G) {
          const t = temps[node - G - 1] as Temp;
          if (!t.start) visit(G, distance(t, goal));
        } else {
          const tangent = graph.tangentTo[node] as number;
          if (tangent !== -1) visit(tangent, graph.tangentLength[node] as number);
          const arc = graph.arcNext[node] as number;
          if (arc !== -1) visit(arc, graph.arcLength[node] as number);
        }
        for (const edge of extra.get(node) ?? []) visit(edge.to, edge.cost);
      },
      heuristic: (node) => distance(pointOf(node), goal),
    },
    S,
    G,
  );

  let path = result.path;
  let tail: Vec2 | null = null;
  if (!path) {
    // Unreachable: from the start and the reachable nodes closest to the goal, slide toward it
    // like a body would, and stop at the end that gets closest (if it's in a straight line).
    const candidates = [S, ...result.settled.filter((node) => node !== S)]
      .map((node) => ({ node, d: distance(pointOf(node), goal) }))
      .sort((a, b) => a.d - b.d || a.node - b.node)
      .slice(0, FALLBACK_CANDIDATES);
    let best = { node: S, end: start, d: distance(start, goal) };
    for (const { node } of candidates) {
      const q = pointOf(node);
      const d0 = distance(q, goal);
      if (d0 < best.d) best = { node, end: q, d: d0 };
      const end = moveAndSlide(
        graph.shapes,
        q,
        { x: goal.x - q.x, z: goal.z - q.z },
        graph.pad,
      ).position;
      const d = distance(end, goal);
      if (d < best.d && isFree(graph, end) && lineClear(graph, q, end)) best = { node, end, d };
    }
    path = pathTo(result.parent, best.node);
    goal = { x: best.end.x, z: best.end.z };
    if (distance(pointOf(best.node), goal) > 1e-9) tail = goal;
  }

  const circleOf = (node: number) =>
    node === S || node === G
      ? -1
      : node > G
        ? (temps[node - G - 1] as Temp).circle
        : (graph.nodeCircle[node] as number);
  const points: Vec2[] = [...lead];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as number;
    const b = path[i] as number;
    const circle = circleOf(a);
    if (circle !== -1 && circle === circleOf(b)) {
      const c = graph.circles[circle] as NavCircle;
      const pa = pointOf(a);
      const orient = a > G ? (temps[a - G - 1] as Temp).orient : (graph.nodeOrient[a] as number);
      arcPoints(c, angleOn(c, pa), angleOn(c, pointOf(b)), orient, points);
    }
    points.push(b === G ? goal : pointOf(b));
  }
  if (tail) points.push(tail);
  return finish(goal, points);
}

/**
 * The node next to `angle` round a ring in `orient` (`after`), or the one before it: the ring's
 * nodes are sorted by angle, and equal angles count as next to it.
 */
function neighbour(
  graph: NavGraph,
  ring: number[],
  angle: number,
  orient: number,
  after: boolean,
): number {
  if (!ring.length) return -1;
  const ahead = orient > 0 === after;
  // First index whose angle is >= angle (ahead) or last index whose angle is <= angle (behind).
  if (ahead) {
    for (const node of ring) if ((graph.nodeAngle[node] as number) >= angle) return node;
    return ring[0] as number;
  }
  for (let i = ring.length - 1; i >= 0; i--) {
    const node = ring[i] as number;
    if ((graph.nodeAngle[node] as number) <= angle) return node;
  }
  return ring[ring.length - 1] as number;
}

/**
 * Corners for walking an arc as straights: a polygon round the circle whose sides touch it, fine
 * enough that its corners stick out at most ARC_BULGE. The sides at the ends continue the tangents
 * arriving and leaving, so the path stays smooth.
 */
function arcPoints(c: NavCircle, from: number, to: number, orient: number, out: Vec2[]): void {
  const delta = arcDelta(from, to, orient);
  if (delta < 1e-9) return;
  const maxStep =
    2 * dmath.atan2(Math.sqrt((c.r + ARC_BULGE) * (c.r + ARC_BULGE) - c.r * c.r), c.r);
  const steps = Math.ceil(delta / maxStep);
  const step = delta / steps;
  const r = c.r / dmath.cos(step / 2);
  for (let k = 0; k < steps; k++) {
    const angle = from + orient * step * (k + 0.5);
    out.push({ x: c.x + r * dmath.cos(angle), z: c.z + r * dmath.sin(angle) });
  }
}

/** The path as plain data: fresh objects, and no zero-length legs. */
function finish(goal: Vec2, points: Vec2[]): NavPath {
  const waypoints: Vec2[] = [];
  for (const p of points) {
    const last = waypoints[waypoints.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    waypoints.push({ x: p.x, z: p.z });
  }
  const end = waypoints[waypoints.length - 1];
  if (end) {
    end.x = goal.x;
    end.z = goal.z;
  }
  return { goal: { x: goal.x, z: goal.z }, waypoints };
}
