import type { World } from "miniplex";
import { dmath } from "@/core/dmath";
import { TAU, type Vec2 } from "@/core/math";
import { boxCorners, distanceToShape, type ObstacleShape, shapeBounds } from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";
import { segmentDistance } from "@/nav/shapes";

// The nav graph: exact any-angle pathing for a body of radius `pad`, against the same grown shapes
// collision uses. Growing every obstacle by `pad` turns a pillar into a bigger circle and a box
// into a rounded rectangle, whose corners are circles of radius `pad` and whose sides are the
// tangents between them. So the free space is bounded by circles, and a shortest path is made of
// straight tangent lines between circles and arcs along them.
//
// Nodes are points on circles, each with a direction of travel round its circle (orientation
// +1 = counter-clockwise seen from above with +X right and +Z up, -1 = clockwise). Edges are the
// tangent segments between circles that clear every shape, and arcs between neighbouring nodes on
// a circle that stay out of every other shape. Queries (`findPath`) add the start and goal.
//
// Derived, never simulation state: cached per world and rebuilt when `pad` changes.

/** How close to a grown outline a path may run: tangents touch the outlines exactly. */
export const NAV_EPS = 1e-6;
/** Spacing of the samples that decide which parts of a circle are free to walk along, m. */
const ARC_SAMPLE = 0.02;

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export type NavCircle = {
  x: number;
  z: number;
  r: number;
  /** Samples around the circle; `blockedBefore[i]` counts the blocked ones before sample i. */
  samples: number;
  blockedBefore: Int32Array;
};

export type NavGraph = {
  pad: number;
  /** Half the room's inner size; bodies keep `pad` from its edges. */
  halfW: number;
  halfD: number;
  shapes: readonly ObstacleShape[];
  /** Each shape's bounds grown by `pad`, to skip far shapes quickly. */
  grown: Bounds[];
  circles: NavCircle[];
  // Nodes, by index.
  nodeCircle: number[];
  nodeX: number[];
  nodeZ: number[];
  /** Angle on its circle, in [0, 2π). */
  nodeAngle: number[];
  nodeOrient: number[];
  /** The node a tangent segment leaving this node arrives at, or -1. */
  tangentTo: number[];
  tangentLength: number[];
  /** The next node along the circle in this node's orientation, if the arc there is free; else -1. */
  arcNext: number[];
  arcLength: number[];
  /** Per circle and orientation (`ringOf`), its nodes sorted by angle (ties by index). */
  rings: number[][];
};

type Area = { width: number; depth: number };

export const ringOf = (circle: number, orient: number) => circle * 2 + (orient > 0 ? 1 : 0);

/** Builds the graph for bodies of radius `pad` in a `width` × `depth` room centered on the origin. */
export function buildNavGraph(area: Area, shapes: readonly ObstacleShape[], pad: number): NavGraph {
  const graph: NavGraph = {
    pad,
    halfW: area.width / 2,
    halfD: area.depth / 2,
    shapes,
    grown: shapes.map((shape) => {
      const b = shapeBounds(shape);
      return { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
    }),
    circles: [],
    nodeCircle: [],
    nodeX: [],
    nodeZ: [],
    nodeAngle: [],
    nodeOrient: [],
    tangentTo: [],
    tangentLength: [],
    arcNext: [],
    arcLength: [],
    rings: [],
  };

  for (const shape of shapes) {
    if (shape.kind === "circle") addCircle(graph, shape.x, shape.z, shape.r + pad);
    else for (const corner of boxCorners(shape)) addCircle(graph, corner.x, corner.z, pad);
  }
  for (let i = 0; i < graph.circles.length; i++) graph.rings.push([], []);

  // Tangent segments between every pair of circles that clear every shape, both ways.
  const circles = graph.circles;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      for (const [p1, p2] of bitangents(circles[i] as NavCircle, circles[j] as NavCircle)) {
        const length = dmath.hypot(p2.x - p1.x, p2.z - p1.z);
        if (length < 1e-9 || !segmentFree(graph, p1, p2)) continue;
        const o1 = orientation(circles[i] as NavCircle, p1, p2.x - p1.x, p2.z - p1.z);
        const o2 = orientation(circles[j] as NavCircle, p2, p2.x - p1.x, p2.z - p1.z);
        const out = addNode(graph, i, p1, o1);
        const arrive = addNode(graph, j, p2, o2);
        const back = addNode(graph, j, p2, -o2);
        const home = addNode(graph, i, p1, -o1);
        link(graph, out, arrive, length);
        link(graph, back, home, length);
      }
    }
  }

  // Arcs between neighbouring nodes on each circle, in each orientation.
  for (let ring = 0; ring < graph.rings.length; ring++) {
    const nodes = graph.rings[ring] as number[];
    nodes.sort((a, b) => (graph.nodeAngle[a] as number) - (graph.nodeAngle[b] as number) || a - b);
    if (nodes.length < 2) continue;
    const circle = circles[ring >> 1] as NavCircle;
    const orient = ring & 1 ? 1 : -1;
    nodes.forEach((node, i) => {
      const next = nodes[(i + orient + nodes.length) % nodes.length] as number;
      const from = graph.nodeAngle[node] as number;
      const delta = arcDelta(from, graph.nodeAngle[next] as number, orient);
      if (!arcFree(circle, from, orient, delta)) return;
      graph.arcNext[node] = next;
      graph.arcLength[node] = circle.r * delta;
    });
  }
  return graph;
}

function addCircle(graph: NavGraph, x: number, z: number, r: number): void {
  const samples = Math.min(720, Math.max(64, Math.ceil((TAU * r) / ARC_SAMPLE)));
  const blockedBefore = new Int32Array(samples + 1);
  for (let i = 0; i < samples; i++) {
    const angle = (TAU * i) / samples;
    const p = { x: x + r * dmath.cos(angle), z: z + r * dmath.sin(angle) };
    blockedBefore[i + 1] = (blockedBefore[i] as number) + (pointFree(graph, p) ? 0 : 1);
  }
  graph.circles.push({ x, z, r, samples, blockedBefore });
}

export function addNode(graph: NavGraph, circle: number, p: Vec2, orient: number): number {
  const c = graph.circles[circle] as NavCircle;
  const node = graph.nodeCircle.length;
  graph.nodeCircle.push(circle);
  graph.nodeX.push(p.x);
  graph.nodeZ.push(p.z);
  graph.nodeAngle.push(angleOn(c, p));
  graph.nodeOrient.push(orient);
  graph.tangentTo.push(-1);
  graph.tangentLength.push(0);
  graph.arcNext.push(-1);
  graph.arcLength.push(0);
  graph.rings[ringOf(circle, orient)]?.push(node);
  return node;
}

function link(graph: NavGraph, from: number, to: number, length: number): void {
  graph.tangentTo[from] = to;
  graph.tangentLength[from] = length;
}

/** The angle of `p` around the circle's center, in [0, 2π). */
export function angleOn(c: NavCircle, p: Vec2): number {
  const angle = dmath.atan2(p.z - c.z, p.x - c.x);
  return angle < 0 ? angle + TAU : angle;
}

/** Which way round the circle a body at `p` moving along (dx, dz) is going: +1 or -1. */
export function orientation(c: NavCircle, p: Vec2, dx: number, dz: number): number {
  return (p.x - c.x) * dz - (p.z - c.z) * dx >= 0 ? 1 : -1;
}

/** How far round the circle from angle `from` to angle `to` going in `orient`, in [0, 2π). */
export function arcDelta(from: number, to: number, orient: number): number {
  const delta = orient > 0 ? to - from : from - to;
  return delta < 0 ? delta + TAU : delta;
}

/** Whether the arc from `from` going `delta` radians in `orient` stays clear of every shape. */
export function arcFree(c: NavCircle, from: number, orient: number, delta: number): boolean {
  if (delta <= 0) return true;
  let start = orient > 0 ? from : from - delta;
  if (start < 0) start += TAU;
  const step = TAU / c.samples;
  // Only the samples strictly inside the arc: its ends are nodes, checked on their own.
  const first = Math.floor(start / step) + 1;
  const last = Math.ceil((start + delta) / step) - 1;
  if (last < first) return true;
  if (last - first + 1 >= c.samples) return c.blockedBefore[c.samples] === 0;
  const count = (lo: number, hi: number) =>
    (c.blockedBefore[hi + 1] as number) - (c.blockedBefore[lo] as number);
  const lo = first % c.samples;
  const hi = last % c.samples;
  const blocked = lo <= hi ? count(lo, hi) : count(lo, c.samples - 1) + count(0, hi);
  return blocked === 0;
}

/** Common tangents of two circles as [point on a, point on b] pairs: outer ones, then inner ones. */
function bitangents(a: NavCircle, b: NavCircle): [Vec2, Vec2][] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = dmath.hypot(dx, dz);
  if (d < 1e-12) return [];
  const vx = dx / d;
  const vz = dz / d;
  const tangents: [Vec2, Vec2][] = [];
  for (const side of [1, -1]) {
    // The tangent line's normal n has n·v = k; points are a + ra·n and b + side·rb·n.
    const k = (a.r - side * b.r) / d;
    if (k * k > 1) continue;
    const h = Math.sqrt(Math.max(0, 1 - k * k));
    for (const turn of h === 0 ? [1] : [1, -1]) {
      const nx = k * vx - turn * h * vz;
      const nz = k * vz + turn * h * vx;
      tangents.push([
        { x: a.x + a.r * nx, z: a.z + a.r * nz },
        { x: b.x + side * b.r * nx, z: b.z + side * b.r * nz },
      ]);
    }
  }
  return tangents;
}

/**
 * Where lines from `p` touch the circle: two points, `p` itself if it's on the circle, or none if
 * it's inside.
 */
export function tangentsFrom(p: Vec2, c: NavCircle): Vec2[] {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = dmath.hypot(dx, dz);
  if (d < c.r - NAV_EPS) return [];
  if (d <= c.r + 1e-9) return [{ x: p.x, z: p.z }];
  const base = dmath.atan2(dz, dx);
  const spread = dmath.atan2(Math.sqrt(d * d - c.r * c.r), c.r);
  return [base + spread, base - spread].map((angle) => ({
    x: c.x + c.r * dmath.cos(angle),
    z: c.z + c.r * dmath.sin(angle),
  }));
}

const inRoom = (graph: NavGraph, p: Vec2) =>
  Math.abs(p.x) <= graph.halfW - graph.pad + NAV_EPS &&
  Math.abs(p.z) <= graph.halfD - graph.pad + NAV_EPS;

/** Whether a body standing at `p` is inside the room and clear of every shape (within NAV_EPS). */
export function pointFree(graph: NavGraph, p: Vec2): boolean {
  if (!inRoom(graph, p)) return false;
  const pad = graph.pad - NAV_EPS;
  return graph.shapes.every((shape, i) => {
    const b = graph.grown[i] as Bounds;
    if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) return true;
    return distanceToShape(p, shape) >= pad;
  });
}

/** Whether a body can walk straight from `a` to `b` (within NAV_EPS of the grown outlines). */
export function segmentFree(graph: NavGraph, a: Vec2, b: Vec2): boolean {
  // The room is convex, so a segment between two points inside stays inside.
  if (!inRoom(graph, a) || !inRoom(graph, b)) return false;
  const pad = graph.pad - NAV_EPS;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  return graph.shapes.every((shape, i) => {
    const g = graph.grown[i] as Bounds;
    if (maxX < g.minX || minX > g.maxX || maxZ < g.minZ || minZ > g.maxZ) return true;
    return segmentDistance(a, b, shape) >= pad;
  });
}

const cache = new WeakMap<World<Entity>, NavGraph>();

/**
 * The world's nav graph for bodies of radius `pad`, built from its `room` and `obstacle` entities
 * on first use and again when `pad` changes. Null without a room. Editing an obstacle later doesn't
 * rebuild it (that waits for a room editor).
 */
export function navGraphOf(world: World<Entity>, pad: number): NavGraph | null {
  const cached = cache.get(world);
  if (cached && cached.pad === pad) return cached;
  const room = world.with("room").first?.room;
  if (!room) return null;
  const shapes = [...world.with("obstacle")].map((entity) => entity.obstacle.shape);
  const graph = buildNavGraph(room, shapes, pad);
  cache.set(world, graph);
  return graph;
}
