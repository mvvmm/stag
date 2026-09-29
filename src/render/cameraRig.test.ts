import { describe, expect, it } from "vitest";
import {
  type CameraRigInput,
  clampToRect,
  createCameraRig,
  easeFactor,
  edgePanDirection,
  lookAheadOffset,
} from "@/render/cameraRig";

const W = 1600;
const H = 900;
const center = { x: W / 2, y: H / 2 };
const options = { distance: 3, deadZone: 0.2 };

describe("lookAheadOffset", () => {
  it("is zero at the center and inside the dead zone", () => {
    expect(lookAheadOffset(center, W, H, 0, options)).toEqual({ x: 0, z: 0 });
    // 0.2 of half the shorter side (450 px) is 90 px.
    const inside = lookAheadOffset({ x: center.x + 89, y: center.y }, W, H, 0, options);
    expect(inside).toEqual({ x: 0, z: 0 });
  });

  it("starts from zero at the dead zone's edge (no step)", () => {
    const just = lookAheadOffset({ x: center.x + 91, y: center.y }, W, H, 0, options);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.01);
  });

  it("reaches the full distance at the shorter side's edge and clamps past it", () => {
    const edge = lookAheadOffset({ x: center.x + 450, y: center.y }, W, H, 0, options);
    expect(edge.x).toBeCloseTo(3);
    const corner = lookAheadOffset({ x: W, y: 0 }, W, H, 0, options);
    expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(3);
  });

  it("maps screen right/up to the camera's right/forward on the ground", () => {
    const right = { x: center.x + 450, y: center.y };
    const up = { x: center.x, y: center.y - 450 };
    // Yaw 0 looks along +Z: right is +X, up is +Z.
    expect(lookAheadOffset(right, W, H, 0, options).x).toBeCloseTo(3);
    expect(lookAheadOffset(up, W, H, 0, options).z).toBeCloseTo(3);
    // Yaw 90° looks along +X: up is +X, right is -Z.
    const yaw = Math.PI / 2;
    expect(lookAheadOffset(up, W, H, yaw, options).x).toBeCloseTo(3);
    expect(lookAheadOffset(right, W, H, yaw, options).z).toBeCloseTo(-3);
  });

  it("is zero with no distance or an empty viewport", () => {
    const edge = { x: W, y: H / 2 };
    expect(lookAheadOffset(edge, W, H, 0, { distance: 0, deadZone: 0 })).toEqual({ x: 0, z: 0 });
    expect(lookAheadOffset(edge, 0, 0, 0, options)).toEqual({ x: 0, z: 0 });
  });
});

describe("easeFactor", () => {
  it("snaps with no lag", () => {
    expect(easeFactor(0, 1 / 60)).toBe(1);
  });

  it("is independent of the frame rate", () => {
    const one = easeFactor(0.25, 1 / 30);
    const half = easeFactor(0.25, 1 / 60);
    // Two half steps cover the same remaining fraction as one full step.
    expect(1 - one).toBeCloseTo((1 - half) * (1 - half), 12);
  });
});

describe("clampToRect", () => {
  const room = { minX: -15, maxX: 15, minZ: -10, maxZ: 10 };

  it("clamps to the rect shrunk by the inset", () => {
    expect(clampToRect({ x: 20, z: -20 }, room, 4)).toEqual({ x: 11, z: -6 });
    expect(clampToRect({ x: 1, z: 2 }, room, 4)).toEqual({ x: 1, z: 2 });
  });

  it("grows the rect with a negative inset", () => {
    expect(clampToRect({ x: 20, z: 0 }, room, -2)).toEqual({ x: 17, z: 0 });
  });

  it("pins an axis to the center when the inset inverts it", () => {
    expect(clampToRect({ x: 5, z: 5 }, room, 16)).toEqual({ x: 0, z: 0 });
    expect(clampToRect({ x: 5, z: 5 }, room, 12)).toEqual({ x: 3, z: 0 });
  });
});

describe("createCameraRig", () => {
  const input = (overrides: Partial<CameraRigInput> = {}): CameraRigInput => ({
    target: { x: 0, z: 0 },
    offset: { x: 0, z: 0 },
    bounds: null,
    follow: 0,
    lookAheadLag: 0.25,
    inset: 0,
    ...overrides,
  });
  const dt = 1 / 60;

  it("starts on the target with no offset", () => {
    const rig = createCameraRig();
    const at = rig.update(input({ target: { x: 5, z: 3 }, offset: { x: 3, z: 0 } }), dt);
    expect(at).toEqual({ x: 5, z: 3 });
  });

  it("pins the player and eases the offset toward the cursor's", () => {
    const rig = createCameraRig();
    rig.update(input(), dt);
    const first = rig.update(input({ target: { x: 0.1, z: 0 }, offset: { x: 3, z: 0 } }), dt);
    expect(first.x).toBeGreaterThan(0.1);
    expect(first.x).toBeLessThan(0.1 + 3);
    let at = first;
    for (let i = 0; i < 300; i++)
      at = rig.update(input({ target: { x: 0.1, z: 0 }, offset: { x: 3, z: 0 } }), dt);
    expect(at.x).toBeCloseTo(3.1, 6);
  });

  it("holds the offset when there's no new one (paused)", () => {
    const rig = createCameraRig();
    rig.update(input(), dt);
    for (let i = 0; i < 10; i++) rig.update(input({ offset: { x: 3, z: 0 } }), dt);
    const held = rig.offset.x;
    const at = rig.update(input({ offset: null }), dt);
    expect(at.x).toBe(held);
  });

  it("snaps on a big target jump and after snap()", () => {
    const rig = createCameraRig();
    rig.update(input(), dt);
    for (let i = 0; i < 60; i++) rig.update(input({ offset: { x: 3, z: 0 }, follow: 0.2 }), dt);
    expect(
      rig.update(input({ target: { x: 10, z: 0 }, offset: { x: 3, z: 0 }, follow: 0.2 }), dt),
    ).toEqual({ x: 10, z: 0 });
    for (let i = 0; i < 60; i++)
      rig.update(input({ target: { x: 10, z: 0 }, offset: { x: 3, z: 0 } }), dt);
    rig.snap();
    expect(rig.update(input({ target: { x: 10.5, z: 0 }, offset: { x: 3, z: 0 } }), dt)).toEqual({
      x: 10.5,
      z: 0,
    });
  });

  it("lags the player with a follow lag", () => {
    const rig = createCameraRig();
    rig.update(input({ offset: null }), dt);
    const at = rig.update(input({ target: { x: 1, z: 0 }, offset: null, follow: 0.1 }), dt);
    expect(at.x).toBeGreaterThan(0);
    expect(at.x).toBeLessThan(1);
  });

  it("clamps after smoothing, so the look-ahead can't push past the bounds", () => {
    const rig = createCameraRig();
    const bounds = { minX: -15, maxX: 15, minZ: -10, maxZ: 10 };
    const near = input({ target: { x: 10, z: 0 }, offset: { x: 3, z: 0 }, bounds, inset: 4 });
    let at = rig.update(near, dt);
    for (let i = 0; i < 300; i++) at = rig.update(near, dt);
    expect(at).toEqual({ x: 11, z: 0 });
  });
});

describe("edgePanDirection", () => {
  const W = 1000;
  const H = 600;
  it("is zero away from the edges", () => {
    expect(edgePanDirection({ x: 500, y: 300 }, W, H, 0, 20)).toEqual({ x: 0, z: 0 });
    expect(edgePanDirection({ x: 21, y: 579 }, W, H, 0, 20)).toEqual({ x: 0, z: 0 });
  });

  it("points toward the edge the cursor is at (screen up is forward)", () => {
    expect(edgePanDirection({ x: 0, y: 300 }, W, H, 0, 20)).toEqual({ x: -1, z: 0 });
    expect(edgePanDirection({ x: W, y: 300 }, W, H, 0, 20)).toEqual({ x: 1, z: 0 });
    const up = edgePanDirection({ x: 500, y: 5 }, W, H, 0, 20);
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(1);
    const down = edgePanDirection({ x: 500, y: H - 5 }, W, H, 0, 20);
    expect(down.z).toBeCloseTo(-1);
  });

  it("is unit length in a corner, and turns with the camera", () => {
    const corner = edgePanDirection({ x: W, y: 0 }, W, H, 0, 20);
    expect(Math.hypot(corner.x, corner.z)).toBeCloseTo(1);
    const turned = edgePanDirection({ x: 500, y: 0 }, W, H, Math.PI / 2, 20);
    expect(turned.x).toBeCloseTo(1);
    expect(turned.z).toBeCloseTo(0);
  });
});
