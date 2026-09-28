import { describe, expect, it } from "vitest";
import { moveAndSlide, SKIN } from "@/collision/slide";
import { dmath } from "@/core/dmath";
import { createRng } from "@/core/rng";
import { greyboxRoom } from "@/data/rooms/greybox";
import { gymRoom } from "@/data/rooms/gym";
import { distanceToShape, type Room } from "@/data/rooms/room";

// Collision against the real rooms: long seeded random walks must never end a tick inside an
// obstacle, never need the safety net, and never leave the room.

const DT = 1 / 60;

describe.each([greyboxRoom, gymRoom].map((room) => [room.id, room] as const))(
  "moveAndSlide in %s",
  (_id, room: Room) => {
    const shapes = room.obstacles.map((o) => o.shape);

    it.each([0.4, 0.65])("random walks at up to 50 m/s never overlap (radius %s)", (radius) => {
      const rng = createRng(radius === 0.4 ? 1 : 2);
      let p = { x: room.spawn.x, z: room.spawn.z };
      let angle = 0;
      let speed = 7;
      for (let tick = 0; tick < 20_000; tick++) {
        // Mostly steady headings, so the walk pushes along walls and into corners for a while.
        if (rng.next() < 0.03) angle = rng.range(0, Math.PI * 2);
        if (rng.next() < 0.01) speed = rng.next() < 0.2 ? rng.range(20, 50) : rng.range(1, 10);
        const motion = { x: dmath.cos(angle) * speed * DT, z: dmath.sin(angle) * speed * DT };
        const result = moveAndSlide(shapes, p, motion, radius);
        expect(result.depenetrated).toBe(false);
        p = result.position;
        for (const shape of shapes) {
          if (distanceToShape(p, shape) < radius - SKIN) {
            throw new Error(
              `tick ${tick}: inside ${JSON.stringify(shape)} at ${JSON.stringify(p)}`,
            );
          }
        }
        expect(Math.abs(p.x)).toBeLessThan(room.width / 2);
        expect(Math.abs(p.z)).toBeLessThan(room.depth / 2);
      }
    });
  },
);

describe("moveAndSlide budget", () => {
  it("costs well under 20 µs a tick for the player in the greybox room", () => {
    const shapes = greyboxRoom.obstacles.map((o) => o.shape);
    const rng = createRng(3);
    let p = { ...greyboxRoom.spawn };
    let angle = 0;
    const runs = 20_000;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) {
      if (rng.next() < 0.03) angle = rng.range(0, Math.PI * 2);
      p = moveAndSlide(
        shapes,
        p,
        { x: dmath.cos(angle) * 0.12, z: dmath.sin(angle) * 0.12 },
        0.4,
      ).position;
    }
    const each = (performance.now() - t0) / runs;
    // The budget is 20 µs; loose, so a busy CI machine doesn't flake it.
    expect(each).toBeLessThan(0.1);
  });
});
