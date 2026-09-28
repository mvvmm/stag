import { describe, expect, it } from "vitest";
import { greyboxRoom } from "@/data/rooms/greybox";
import { gymRoom } from "@/data/rooms/gym";
import {
  boxCorners,
  distanceToShape,
  type ObstacleShape,
  perimeterWalls,
  type Room,
  shapeBounds,
  WALL_THICKNESS,
} from "@/data/rooms/room";

const box = (w: number, d: number, yaw = 0): ObstacleShape => ({
  kind: "box",
  x: 1,
  z: 2,
  w,
  d,
  yaw,
});

describe("room shapes", () => {
  it("rotates box corners like Babylon's rotation.y", () => {
    const corners = boxCorners({ kind: "box", x: 0, z: 0, w: 2, d: 0, yaw: Math.PI / 2 });
    // Local +X (east) turns to world -Z at a quarter turn.
    expect(corners[1]?.x).toBeCloseTo(0);
    expect(corners[1]?.z).toBeCloseTo(-1);
  });

  it("measures signed distance to circles and rotated boxes", () => {
    const circle: ObstacleShape = { kind: "circle", x: 0, z: 0, r: 1 };
    expect(distanceToShape({ x: 3, z: 0 }, circle)).toBeCloseTo(2);
    expect(distanceToShape({ x: 0, z: 0 }, circle)).toBeCloseTo(-1);

    expect(distanceToShape({ x: 4, z: 2 }, box(2, 1))).toBeCloseTo(2);
    expect(distanceToShape({ x: 1, z: 2 }, box(2, 1))).toBeCloseTo(-0.5);
    expect(distanceToShape({ x: 3, z: 3.5 }, box(2, 1))).toBeCloseTo(Math.hypot(1, 1));
    // Turned a quarter, the long side runs along Z.
    expect(distanceToShape({ x: 1, z: 4 }, box(2, 1, Math.PI / 2))).toBeCloseTo(1);
    expect(distanceToShape({ x: 3, z: 2 }, box(2, 1, Math.PI / 2))).toBeCloseTo(1.5);
  });

  it("bounds rotated boxes by their corners", () => {
    const bounds = shapeBounds({ kind: "box", x: 0, z: 0, w: 2, d: 2, yaw: Math.PI / 4 });
    expect(bounds.maxX).toBeCloseTo(Math.SQRT2);
    expect(bounds.minZ).toBeCloseTo(-Math.SQRT2);
  });

  it("closes the perimeter", () => {
    const walls = perimeterWalls(10, 6).map((o) => o.shape);
    const inWall = (x: number, z: number) =>
      walls.some((s) => distanceToShape({ x, z }, s) <= 1e-9);
    const edge = WALL_THICKNESS / 2;
    for (let x = -5 - edge; x <= 5 + edge; x += 0.25) {
      expect(inWall(x, 3 + edge)).toBe(true);
      expect(inWall(x, -3 - edge)).toBe(true);
    }
    for (let z = -3 - edge; z <= 3 + edge; z += 0.25) {
      expect(inWall(5 + edge, z)).toBe(true);
      expect(inWall(-5 - edge, z)).toBe(true);
    }
    expect(inWall(0, 0)).toBe(false);
  });
});

/** Checks every hand-built room against the basic rules. */
const rooms: Room[] = [greyboxRoom, gymRoom];

describe.each(rooms.map((room) => [room.id, room] as const))("room %s", (_id, room) => {
  it("has finite shapes with positive sizes", () => {
    for (const { shape, height } of room.obstacles) {
      expect(Number.isFinite(shape.x) && Number.isFinite(shape.z)).toBe(true);
      expect(height).toBeGreaterThan(0);
      if (shape.kind === "circle") expect(shape.r).toBeGreaterThan(0);
      else {
        expect(shape.w).toBeGreaterThan(0);
        expect(shape.d).toBeGreaterThan(0);
        expect(Number.isFinite(shape.yaw)).toBe(true);
      }
    }
  });

  it("keeps every obstacle inside the room and its walls", () => {
    const limitX = room.width / 2 + WALL_THICKNESS + 1e-9;
    const limitZ = room.depth / 2 + WALL_THICKNESS + 1e-9;
    for (const { shape } of room.obstacles) {
      const b = shapeBounds(shape);
      expect(b.minX).toBeGreaterThanOrEqual(-limitX);
      expect(b.maxX).toBeLessThanOrEqual(limitX);
      expect(b.minZ).toBeGreaterThanOrEqual(-limitZ);
      expect(b.maxZ).toBeLessThanOrEqual(limitZ);
    }
  });

  it("spawns clear of every obstacle", () => {
    for (const { shape } of room.obstacles) {
      expect(distanceToShape(room.spawn, shape)).toBeGreaterThan(1);
    }
  });
});
