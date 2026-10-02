import { type Obstacle, perimeterWalls, type Room } from "@/data/rooms/room";

// The Training yard (2.1): an open room to try abilities on dummies. A static dummy north of the
// spawn, a patrolling one crossing the middle, room to circle both, and a few pillars near the
// edges for checking hits against cover later.

const WIDTH = 24;
const DEPTH = 18;

const pillar = (x: number, z: number, r = 0.7): Obstacle => ({
  type: "pillar",
  shape: { kind: "circle", x, z, r },
  height: 3,
});

export const yardRoom: Room = {
  id: "yard",
  width: WIDTH,
  depth: DEPTH,
  spawn: { x: 0, z: -5 },
  obstacles: [...perimeterWalls(WIDTH, DEPTH), pillar(-8.5, 5), pillar(8, 5.5), pillar(-7.5, -5)],
  dummies: [
    { kind: "static", at: { x: 0, z: 4 }, facing: Math.PI },
    { kind: "patrol", a: { x: -5, z: 0 }, b: { x: 5, z: 0 } },
  ],
};
