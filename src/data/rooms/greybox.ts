import { type Obstacle, perimeterWalls, type Room } from "@/data/rooms/room";

// The 1.1 grey-box arena: a combat-sized room with mixed cover to test movement, the camera and
// (from 1.3) collision against. Scattered unevenly so it doesn't read as a test grid.

const WIDTH = 30;
const DEPTH = 20;

const pillar = (x: number, z: number, r = 0.7): Obstacle => ({
  type: "pillar",
  shape: { kind: "circle", x, z, r },
  height: 3,
});
const block = (x: number, z: number, w: number, d: number, yaw = 0): Obstacle => ({
  type: "block",
  shape: { kind: "box", x, z, w, d, yaw },
  height: 1.5,
});
const low = (x: number, z: number, w: number, yaw = 0): Obstacle => ({
  type: "low",
  shape: { kind: "box", x, z, w, d: 0.5, yaw },
  height: 0.6,
});
const wall = (x: number, z: number, w: number, yaw = 0): Obstacle => ({
  type: "wall",
  shape: { kind: "box", x, z, w, d: 0.8, yaw },
  height: 3,
});

export const greyboxRoom: Room = {
  id: "greybox",
  width: WIDTH,
  depth: DEPTH,
  spawn: { x: 0, z: -1 },
  obstacles: [
    ...perimeterWalls(WIDTH, DEPTH),
    // Pillars, scattered.
    pillar(-11, 6),
    pillar(10.5, 6.5),
    pillar(4.5, 3.5, 0.9),
    pillar(-8, -5.5),
    pillar(1.5, -7),
    // Blocks; the two on the east side leave a tight 1.25 m gap between them.
    block(-0.5, 7.5, 3.5, 1.5),
    block(-12, -1, 2, 2),
    block(9.5, -1.5, 2, 2),
    block(12.5, -1.5, 1.5, 3),
    // Low walls: a long straight one and a diagonal one.
    low(-5, 3.5, 8),
    low(6.5, -5.5, 7, 0.5),
    // A tall free-standing wall segment, angled, south-west.
    wall(-4, -6, 4.5, -0.35),
  ],
};
