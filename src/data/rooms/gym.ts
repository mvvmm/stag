import { rotateByYaw, type Vec2 } from "@/core/math";
import { type Obstacle, perimeterWalls, type Room } from "@/data/rooms/room";

// The collision gym (1.3): not a combat room, a test bench of the nasty cases for collision, sized
// for the default player radius of 0.4 m (0.8 m across). Walk into everything with WASD.

const WIDTH = 24;
const DEPTH = 16;

const box = (x: number, z: number, w: number, d: number, yaw = 0): Obstacle => ({
  type: "block",
  shape: { kind: "box", x, z, w, d, yaw },
  height: 1.5,
});
const pillar = (x: number, z: number, r = 0.5): Obstacle => ({
  type: "pillar",
  shape: { kind: "circle", x, z, r },
  height: 3,
});
/** A thin wall `length` long from `from` in the direction `angle` (radians from +X toward +Z). */
const arm = (from: Vec2, angle: number, length: number, thickness = 0.5): Obstacle => {
  // `rotateByYaw` turns clockwise seen from above, so the direction at `angle` is yaw `-angle`.
  const along = rotateByYaw({ x: length / 2, z: 0 }, -angle);
  return {
    type: "wall",
    shape: {
      kind: "box",
      x: from.x + along.x,
      z: from.z + along.z,
      w: length,
      d: thickness,
      yaw: -angle,
    },
    height: 3,
  };
};

const DEG = Math.PI / 180;

/** A 2 × 1.4 box turned by 0.3 rad, with a pillar touching its north-east corner from outside. */
function boxAndCornerPillar(): Obstacle[] {
  const at = { x: -1, z: -5 };
  const yaw = 0.3;
  const r = 0.6;
  const corner = rotateByYaw({ x: 1, z: 0.7 }, yaw);
  const out = rotateByYaw({ x: Math.SQRT1_2, z: Math.SQRT1_2 }, yaw);
  return [
    box(at.x, at.z, 2, 1.4, yaw),
    pillar(at.x + corner.x + out.x * r, at.z + corner.z + out.z * r, r),
  ];
}

export const gymRoom: Room = {
  id: "gym",
  width: WIDTH,
  depth: DEPTH,
  spawn: { x: 1, z: -1 },
  obstacles: [
    ...perimeterWalls(WIDTH, DEPTH),
    // North-west: an acute wedge, two arms at ±15° opening east. Push west into its point.
    arm({ x: -10, z: 5 }, 15 * DEG, 5),
    arm({ x: -10, z: 5 }, -15 * DEG, 5),
    // North: a V between a box leaning 25° and the north wall.
    arm({ x: 1, z: 8 }, 205 * DEG, 4),
    // North-east: a corridor that just fits (0.82 m) and one that just doesn't (0.79 m), 4 m long.
    // The nav grid's 0.25 m cells can't see the 0.82 m one, so only WASD gets through it.
    box(3.5, 3.5, 1, 4),
    box(4 + 0.82 + 0.5, 3.5, 1, 4),
    box(4 + 0.82 + 1 + 0.79 + 0.5, 3.5, 1, 4),
    // South-east: a pillar cluster. Gaps in the front row: 0.9 (fits), 0.7 (doesn't), 0.85 (fits);
    // the back two leave gaps of about 0.95, 0.85, 0.84 and 0.79.
    pillar(4, -4),
    pillar(5.9, -4),
    pillar(7.6, -4),
    pillar(9.45, -4),
    pillar(4.95, -5.7),
    pillar(6.8, -5.6),
    // South-west: two diamonds touching corner to corner, and a box with a pillar on its corner.
    box(-8, -4, 2, 2, 45 * DEG),
    box(-8 + 2 * Math.SQRT2, -4, 2, 2, 45 * DEG),
    ...boxAndCornerPillar(),
    // West: a long diagonal wall to slide along.
    arm({ x: -10.23, z: 3.04 }, -20 * DEG, 9),
  ],
};
