import { describe, expect, it } from "vitest";
import { moveAndSlide } from "@/collision/slide";
import type { Vec2 } from "@/core/math";
import { createRng } from "@/core/rng";
import { greyboxRoom } from "@/data/rooms/greybox";
import { gymRoom } from "@/data/rooms/gym";
import { distanceToShape, type Room } from "@/data/rooms/room";
import { createWorld } from "@/ecs/world";
import { buildNavGraph, navGraphOf } from "@/nav/graph";
import { findPath, isFree, lineClear } from "@/nav/path";
import { spawnRoom } from "@/scenes/arena";

const PAD = 0.4;
const graphFor = (room: Room, pad = PAD) =>
  buildNavGraph(
    room,
    room.obstacles.map((o) => o.shape),
    pad,
  );
const graph = graphFor(greyboxRoom);
const gym = graphFor(gymRoom);

/** Paths touch the grown outlines exactly, and their arcs are walked as straights 1 mm outside. */
const TOLERANCE = 1.1e-3;

/** Walks every leg in small steps and returns the smallest clearance to any obstacle. */
function minClearance(room: Room, from: Vec2, waypoints: Vec2[]): number {
  let clearance = Infinity;
  let a = from;
  for (const b of waypoints) {
    for (let i = 0; i <= 100; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / 100, z: a.z + ((b.z - a.z) * i) / 100 };
      for (const { shape } of room.obstacles) {
        clearance = Math.min(clearance, distanceToShape(p, shape));
      }
    }
    a = b;
  }
  return clearance;
}

const length = (from: Vec2, points: Vec2[]) => {
  let total = 0;
  let a = from;
  for (const b of points) {
    total += Math.hypot(b.x - a.x, b.z - a.z);
    a = b;
  }
  return total;
};

/** Walks the path with collision, one straight move per leg; returns where it ended up. */
function walk(room: Room, from: Vec2, waypoints: Vec2[], radius = PAD): Vec2 {
  const shapes = room.obstacles.map((o) => o.shape);
  let p = from;
  for (const w of waypoints) {
    p = moveAndSlide(shapes, p, { x: w.x - p.x, z: w.z - p.z }, radius).position;
  }
  return p;
}

// The tight gap between the two east blocks: 1.25 m wide, running north–south around x = 11.
const NORTH_OF_GAP = { x: 11.1, z: 1.5 };
const SOUTH_OF_GAP = { x: 11.1, z: -4.5 };

describe("nav graph", () => {
  it("is cached per world and rebuilt when the radius changes", () => {
    const world = createWorld();
    spawnRoom(world, greyboxRoom);
    const a = navGraphOf(world, PAD);
    expect(navGraphOf(world, PAD)).toBe(a);
    const b = navGraphOf(world, 0.6);
    expect(b).not.toBe(a);
    expect(b?.pad).toBe(0.6);
    expect(navGraphOf(createWorld(), PAD)).toBeNull();
  });

  it("only has tangents that clear every obstacle", () => {
    for (let node = 0; node < graph.tangentTo.length; node++) {
      const to = graph.tangentTo[node] as number;
      if (to === -1) continue;
      const a = { x: graph.nodeX[node] as number, z: graph.nodeZ[node] as number };
      const b = { x: graph.nodeX[to] as number, z: graph.nodeZ[to] as number };
      expect(minClearance(greyboxRoom, a, [b])).toBeGreaterThan(PAD - TOLERANCE);
    }
  });
});

describe("findPath", () => {
  const cases: [string, Vec2, Vec2][] = [
    ["across the room", { x: -13, z: -8 }, { x: 13, z: 8 }],
    ["around a pillar", { x: 4.5, z: 1.5 }, { x: 4.5, z: 5.8 }],
    ["around the long low wall", { x: -5, z: 1 }, { x: -5, z: 6 }],
    ["behind the angled wall", { x: -4, z: -3 }, { x: -4, z: -8.5 }],
    ["through the tight gap", NORTH_OF_GAP, SOUTH_OF_GAP],
  ];

  for (const [name, from, to] of cases) {
    it(`keeps its distance from every obstacle and can be walked: ${name}`, () => {
      const path = findPath(graph, from, to);
      expect(path.goal).toEqual(to);
      expect(path.waypoints.at(-1)).toEqual(to);
      expect(minClearance(greyboxRoom, from, path.waypoints)).toBeGreaterThan(PAD - TOLERANCE);
      const end = walk(greyboxRoom, from, path.waypoints);
      expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(0.01);
    });
  }

  it("hugs a pillar: tangent, arc, tangent", () => {
    // The 0.9 m pillar at (4.5, 3.5) grows to 1.3 m. From 2 m south of its center to 2.3 m north:
    // two tangents plus the arc between them.
    const r = 1.3;
    const tangents = Math.sqrt(2 * 2 - r * r) + Math.sqrt(2.3 * 2.3 - r * r);
    const arc = r * (Math.PI - Math.acos(r / 2) - Math.acos(r / 2.3));
    const path = findPath(graph, { x: 4.5, z: 1.5 }, { x: 4.5, z: 5.8 });
    const walked = length({ x: 4.5, z: 1.5 }, path.waypoints);
    expect(walked).toBeGreaterThanOrEqual(tangents + arc - 1e-9);
    expect(walked).toBeLessThan(tangents + arc + 1e-3);
  });

  it("goes straight when nothing is in the way", () => {
    expect(findPath(graph, { x: 0, z: -1 }, { x: 3, z: -2 }).waypoints).toEqual([{ x: 3, z: -2 }]);
  });

  it("uses the 1.25 m gap at radius 0.4 and goes around at 0.65", () => {
    const narrow = findPath(graph, NORTH_OF_GAP, SOUTH_OF_GAP);
    const wide = findPath(graphFor(greyboxRoom, 0.65), NORTH_OF_GAP, SOUTH_OF_GAP);
    expect(length(NORTH_OF_GAP, narrow.waypoints)).toBeLessThan(6.5);
    expect(length(NORTH_OF_GAP, wide.waypoints)).toBeGreaterThan(8);
  });

  it("resolves a goal inside an obstacle or outside the room to the closest free point", () => {
    const intoPillar = findPath(graph, { x: 0, z: -1 }, { x: 4.6, z: 3.5 });
    expect(isFree(graph, intoPillar.goal)).toBe(true);
    // Pushed out of the 0.9 m pillar at (4.5, 3.5), next to where it was clicked.
    expect(Math.hypot(intoPillar.goal.x - 4.5, intoPillar.goal.z - 3.5)).toBeCloseTo(1.32, 6);

    const outside = findPath(graph, { x: 0, z: -1 }, { x: 0, z: -30 });
    expect(isFree(graph, outside.goal)).toBe(true);
    expect(outside.goal.z).toBeCloseTo(-10 + PAD + 0.02, 6);
  });

  it("leads out of an obstacle when it starts inside one", () => {
    const path = findPath(graph, { x: 4.5, z: 3.5 }, { x: 0, z: -1 });
    expect(path.goal).toEqual({ x: 0, z: -1 });
    expect(path.waypoints.length).toBeGreaterThan(0);
    // After the first corner, it's clear.
    const [first, ...rest] = path.waypoints;
    expect(minClearance(greyboxRoom, first as Vec2, rest)).toBeGreaterThan(PAD - TOLERANCE);
  });

  it("stops at the closest reachable point when the goal is walled off", () => {
    const closed: Room = {
      id: "closed",
      width: 10,
      depth: 10,
      spawn: { x: -3, z: 0 },
      obstacles: [
        { type: "wall", shape: { kind: "box", x: 1, z: 0, w: 0.5, d: 10, yaw: 0 }, height: 3 },
      ],
    };
    const path = findPath(graphFor(closed), { x: -3, z: 0 }, { x: 3, z: 0 });
    expect(path.goal.x).toBeCloseTo(1 - 0.25 - PAD, 2); // at the wall, less the collision skin
    expect(Math.abs(path.goal.z)).toBeLessThan(1);
  });

  it("gives the same path every time", () => {
    const a = findPath(graph, { x: -13, z: -8 }, { x: 13, z: 8 });
    const b = findPath(graphFor(greyboxRoom), { x: -13, z: -8 }, { x: 13, z: 8 });
    expect(b).toEqual(a);
  });

  it("is fast enough to repath every tick", () => {
    findPath(graph, { x: -13, z: -8 }, { x: 13, z: 8 }); // warm up the JIT
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) findPath(graph, { x: -13, z: -8 }, { x: 13, z: 8 });
    const each = (performance.now() - t0) / runs;
    // The budget is 1 ms; loose, so a busy CI machine doesn't flake it.
    expect(each).toBeLessThan(3);
  });

  it("checks line of sight against the grown shapes", () => {
    expect(lineClear(graph, { x: 4.5, z: 1.5 }, { x: 4.5, z: 5.8 })).toBe(false);
    expect(lineClear(graph, { x: 0, z: -1 }, { x: 3, z: -2 })).toBe(true);
  });
});

describe("findPath fits exactly the gaps collision lets through (gym)", () => {
  // The pocket inside the triangle of pillars at (5.9, -4), (7.6, -4), (6.8, -5.6), r 0.5. Its only
  // way in at radius 0.4 is the 0.836 m gap between the first and the last (3.6 cm to spare).
  const POCKET = { x: 6.77, z: -4.53 };
  const OUTSIDE = { x: 5.6, z: -6.6 };

  it("paths into the pocket and out again, and collision can walk both", () => {
    for (const [from, to] of [
      [OUTSIDE, POCKET],
      [POCKET, OUTSIDE],
    ] as const) {
      const path = findPath(gym, from, to);
      expect(path.goal).toEqual(to);
      const end = walk(gymRoom, from, path.waypoints);
      expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(0.01);
    }
  });

  it("can't reach the pocket once the player is too wide for the gap", () => {
    const wide = graphFor(gymRoom, 0.43); // 0.86 m across
    expect(isFree(wide, POCKET)).toBe(true);
    const path = findPath(wide, OUTSIDE, POCKET);
    expect(path.goal).not.toEqual(POCKET);
  });

  it("uses the 0.82 m corridor but not the 0.79 m one", () => {
    // Straight up the middle of each corridor (4 m long), from just south to just north.
    const fits = findPath(gym, { x: 4.41, z: 0.8 }, { x: 4.41, z: 6.2 });
    expect(length({ x: 4.41, z: 0.8 }, fits.waypoints)).toBeCloseTo(5.4, 6);
    const tight = findPath(gym, { x: 6.215, z: 0.8 }, { x: 6.215, z: 6.2 });
    expect(length({ x: 6.215, z: 0.8 }, tight.waypoints)).toBeGreaterThan(6);
  });

  it("every path between random free points can be walked with collision", () => {
    for (const room of [greyboxRoom, gymRoom]) {
      const g = room === gymRoom ? gym : graph;
      const rng = createRng(7);
      const point = () => {
        for (;;) {
          const p = {
            x: rng.range(-room.width / 2, room.width / 2),
            z: rng.range(-room.depth / 2, room.depth / 2),
          };
          if (isFree(g, p)) return p;
        }
      };
      for (let i = 0; i < 150; i++) {
        const from = point();
        const path = findPath(g, from, point());
        const end = walk(room, from, path.waypoints);
        expect(Math.hypot(end.x - path.goal.x, end.z - path.goal.z)).toBeLessThan(0.01);
      }
    }
  });
});
