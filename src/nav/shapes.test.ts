import { describe, expect, it } from "vitest";
import { distanceToShape, type ObstacleShape } from "@/data/rooms/room";
import {
  insidePadded,
  pointSegmentDistance,
  pushOut,
  segmentClear,
  segmentDistance,
} from "@/nav/shapes";

const circle: ObstacleShape = { kind: "circle", x: 2, z: 1, r: 1 };
const box: ObstacleShape = { kind: "box", x: 0, z: 0, w: 4, d: 2, yaw: 0 };
const turned: ObstacleShape = { kind: "box", x: 5, z: -3, w: 3, d: 1, yaw: 0.7 };

describe("insidePadded", () => {
  it("grows circles and boxes by the pad", () => {
    expect(insidePadded({ x: 3.3, z: 1 }, circle, 0.4)).toBe(true);
    expect(insidePadded({ x: 3.5, z: 1 }, circle, 0.4)).toBe(false);
    expect(insidePadded({ x: 2.3, z: 0 }, box, 0.4)).toBe(true);
    expect(insidePadded({ x: 2.5, z: 0 }, box, 0.4)).toBe(false);
    // The grown box has rounded corners.
    expect(insidePadded({ x: 2.3, z: 1.3 }, box, 0.4)).toBe(false);
  });
});

describe("pushOut", () => {
  it("leaves points that are already clear alone", () => {
    expect(pushOut({ x: 9, z: 9 }, box, 0.4)).toEqual({ x: 9, z: 9 });
  });

  it("puts points exactly `pad` from the shape", () => {
    const shapes = [circle, box, turned];
    const points = [
      { x: 2.2, z: 1.1 },
      { x: 2, z: 1 }, // a circle's dead center
      { x: 1.5, z: 0.2 },
      { x: -0.3, z: 0.9 },
      { x: 2.2, z: 1.2 }, // in a rounded corner
      { x: 5.1, z: -2.9 },
      { x: 6.2, z: -2 },
    ];
    for (const shape of shapes) {
      for (const p of points) {
        if (!insidePadded(p, shape, 0.4)) continue;
        const out = pushOut(p, shape, 0.4);
        expect(distanceToShape(out, shape)).toBeCloseTo(0.4, 9);
      }
    }
  });

  it("pushes through the nearest side of a box", () => {
    const out = pushOut({ x: 1.5, z: 0.2 }, box, 0.4);
    expect(out.x).toBeCloseTo(2.4, 9);
    expect(out.z).toBeCloseTo(0.2, 9);
  });
});

describe("segmentDistance", () => {
  it("measures point-to-segment distance, including zero-length segments", () => {
    expect(pointSegmentDistance({ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 })).toBe(1);
    expect(pointSegmentDistance({ x: 3, z: 4 }, { x: 0, z: 0 }, { x: 0, z: 0 })).toBe(5);
  });

  it("is zero for segments that cross or touch the shape", () => {
    expect(segmentDistance({ x: -5, z: 0 }, { x: 5, z: 0 }, box)).toBe(0);
    expect(segmentDistance({ x: 0, z: 0 }, { x: 0.1, z: 0 }, box)).toBe(0); // inside
    expect(segmentDistance({ x: 0, z: 1 }, { x: 4, z: 1 }, circle)).toBe(0);
  });

  it("measures the gap to segments that pass by", () => {
    expect(segmentDistance({ x: -5, z: 1.5 }, { x: 5, z: 1.5 }, box)).toBeCloseTo(0.5, 12);
    // Past a corner diagonally: the corner is the closest point.
    const d = segmentDistance({ x: 2, z: 2 }, { x: 3, z: 1 }, box);
    expect(d).toBeCloseTo(pointSegmentDistance({ x: 2, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 1 }), 12);
    expect(segmentDistance({ x: 2, z: 3 }, { x: 4, z: 3 }, circle)).toBeCloseTo(1, 12);
  });

  it("matches dense sampling for a rotated box", () => {
    const segments = [
      [
        { x: 2, z: -5 },
        { x: 8, z: -5 },
      ],
      [
        { x: 3, z: 0 },
        { x: 7, z: -1 },
      ],
      [
        { x: 7, z: -6 },
        { x: 8, z: -2 },
      ],
    ] as const;
    for (const [a, b] of segments) {
      let sampled = Infinity;
      for (let i = 0; i <= 2000; i++) {
        const t = i / 2000;
        const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        sampled = Math.min(sampled, Math.max(0, distanceToShape(p, turned)));
      }
      expect(segmentDistance(a, b, turned)).toBeCloseTo(sampled, 3);
    }
  });

  it("segmentClear compares the gap with the pad, tangent counting as clear", () => {
    expect(segmentClear({ x: -5, z: 1.5 }, { x: 5, z: 1.5 }, box, 0.4)).toBe(true);
    expect(segmentClear({ x: -5, z: 1.5 }, { x: 5, z: 1.5 }, box, 0.5)).toBe(true);
    expect(segmentClear({ x: -5, z: 1.5 }, { x: 5, z: 1.5 }, box, 0.6)).toBe(false);
  });
});
