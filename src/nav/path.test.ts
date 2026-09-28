import { describe, expect, it } from "vitest";
import type { Vec2 } from "@/core/math";
import { greyboxRoom } from "@/data/rooms/greybox";
import { distanceToShape, type Room } from "@/data/rooms/room";
import { createWorld } from "@/ecs/world";
import { astar } from "@/nav/astar";
import { buildNavGrid, cellIndex, navGridOf, nearestFreeCell } from "@/nav/grid";
import { findPath, isFree, lineClear } from "@/nav/path";
import { spawnRoom } from "@/scenes/arena";

const PAD = 0.4;
const gridFor = (room: Room, pad = PAD) =>
  buildNavGrid(
    room,
    room.obstacles.map((o) => o.shape),
    pad,
  );
const grid = gridFor(greyboxRoom);

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

// The tight gap between the two east blocks: 1.25 m wide, running north–south around x = 11.
const NORTH_OF_GAP = { x: 11.1, z: 1.5 };
const SOUTH_OF_GAP = { x: 11.1, z: -4.5 };

describe("nav grid", () => {
  it("blocks cells inside grown obstacles and next to the room's edge", () => {
    const pillar = greyboxRoom.obstacles.find((o) => o.type === "pillar")?.shape;
    if (pillar?.kind !== "circle") throw new Error("no pillar");
    expect(grid.blocked[cellIndex(grid, pillar)]).toBe(1);
    expect(grid.blocked[cellIndex(grid, greyboxRoom.spawn)]).toBe(0);
    expect(grid.blocked[cellIndex(grid, { x: -14.9, z: 0 })]).toBe(1);
  });

  it("finds the nearest walkable cell", () => {
    expect(nearestFreeCell(grid, cellIndex(grid, greyboxRoom.spawn))).toBe(
      cellIndex(grid, greyboxRoom.spawn),
    );
    const pillar = { x: -11, z: 6 };
    const free = nearestFreeCell(grid, cellIndex(grid, pillar));
    expect(free).not.toBeNull();
    expect(grid.blocked[free as number]).toBe(0);
  });

  it("is cached per world and rebuilt when the radius changes", () => {
    const world = createWorld();
    spawnRoom(world, greyboxRoom);
    const a = navGridOf(world, PAD);
    expect(navGridOf(world, PAD)).toBe(a);
    const b = navGridOf(world, 0.6);
    expect(b).not.toBe(a);
    expect(b?.pad).toBe(0.6);
    expect(navGridOf(createWorld(), PAD)).toBeNull();
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
    it(`keeps its distance from every obstacle: ${name}`, () => {
      const path = findPath(grid, from, to);
      expect(path.goal).toEqual(to);
      expect(path.waypoints.at(-1)).toEqual(to);
      // Pulled tight: a handful of corners, not a staircase of cells.
      expect(path.waypoints.length).toBeLessThan(8);
      expect(minClearance(greyboxRoom, from, path.waypoints)).toBeGreaterThan(PAD - 1e-9);
    });
  }

  it("goes straight when nothing is in the way", () => {
    expect(findPath(grid, { x: 0, z: -1 }, { x: 3, z: -2 }).waypoints).toEqual([{ x: 3, z: -2 }]);
  });

  it("uses the 1.25 m gap at radius 0.4 and goes around at 0.65", () => {
    const narrow = findPath(grid, NORTH_OF_GAP, SOUTH_OF_GAP);
    const wide = findPath(gridFor(greyboxRoom, 0.65), NORTH_OF_GAP, SOUTH_OF_GAP);
    const length = (from: Vec2, points: Vec2[]) => {
      let total = 0;
      let a = from;
      for (const b of points) {
        total += Math.hypot(b.x - a.x, b.z - a.z);
        a = b;
      }
      return total;
    };
    expect(length(NORTH_OF_GAP, narrow.waypoints)).toBeLessThan(6.5);
    expect(length(NORTH_OF_GAP, wide.waypoints)).toBeGreaterThan(8);
  });

  it("resolves a goal inside an obstacle or outside the room to the closest free point", () => {
    const intoPillar = findPath(grid, { x: 0, z: -1 }, { x: 4.6, z: 3.5 });
    expect(isFree(grid, intoPillar.goal)).toBe(true);
    // Pushed out of the 0.9 m pillar at (4.5, 3.5), next to where it was clicked.
    expect(Math.hypot(intoPillar.goal.x - 4.5, intoPillar.goal.z - 3.5)).toBeCloseTo(1.32, 6);

    const outside = findPath(grid, { x: 0, z: -1 }, { x: 0, z: -30 });
    expect(isFree(grid, outside.goal)).toBe(true);
    expect(outside.goal.z).toBeCloseTo(-10 + PAD + 0.02, 6);
  });

  it("leads out of an obstacle when it starts inside one", () => {
    const path = findPath(grid, { x: 4.5, z: 3.5 }, { x: 0, z: -1 });
    expect(path.goal).toEqual({ x: 0, z: -1 });
    expect(path.waypoints.length).toBeGreaterThan(0);
    // After the first corner, it's clear.
    const [first, ...rest] = path.waypoints;
    expect(minClearance(greyboxRoom, first as Vec2, rest)).toBeGreaterThan(PAD - 1e-9);
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
    const path = findPath(gridFor(closed), { x: -3, z: 0 }, { x: 3, z: 0 });
    expect(path.goal.x).toBeLessThan(1 - 0.25 - PAD + 0.25);
    expect(path.goal.x).toBeGreaterThan(0);
  });

  it("gives the same path every time", () => {
    const a = findPath(grid, { x: -13, z: -8 }, { x: 13, z: 8 });
    const b = findPath(gridFor(greyboxRoom), { x: -13, z: -8 }, { x: 13, z: 8 });
    expect(b).toEqual(a);
  });

  it("is fast enough to repath every tick", () => {
    const start = cellIndex(grid, { x: -13, z: -8 });
    const goal = cellIndex(grid, { x: 13, z: 8 });
    astar(grid, start, goal); // warm up the JIT
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) findPath(grid, { x: -13, z: -8 }, { x: 13, z: 8 });
    const each = (performance.now() - t0) / runs;
    // The budget is 1 ms; loose, so a busy CI machine doesn't flake it.
    expect(each).toBeLessThan(3);
  });

  it("checks line of sight against the grown shapes", () => {
    expect(lineClear(grid, { x: 4.5, z: 1.5 }, { x: 4.5, z: 5.8 })).toBe(false);
    expect(lineClear(grid, { x: 0, z: -1 }, { x: 3, z: -2 })).toBe(true);
  });
});
