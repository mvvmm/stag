import { rotateByYaw, type Vec2 } from "@/core/math";

// The game camera's follow logic (1.4), Babylon-free so it's unit-tested in Node. View-only: it runs
// on frame time and never touches the simulation, so it may use Math.exp and friends.

/** An axis-aligned rectangle on the ground plane. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export type LookAheadOptions = {
  /** Offset in meters with the cursor at (or past) the edge of the shorter screen side. */
  distance: number;
  /** Fraction of the half-screen around the center that gives no offset (0–1). */
  deadZone: number;
};

/**
 * The look-ahead offset for a cursor at `cursor` (CSS pixels) in a `width`×`height` viewport,
 * seen by a camera with `yaw`. The cursor's distance from the center is measured in half the
 * shorter side (so the reach on screen is the same in every direction), clamped to 1, and the dead
 * zone is remapped away so the offset starts at 0 at its edge. Screen up is the camera's forward.
 */
export function lookAheadOffset(
  cursor: { x: number; y: number },
  width: number,
  height: number,
  yaw: number,
  { distance, deadZone }: LookAheadOptions,
): Vec2 {
  const half = Math.min(width, height) / 2;
  if (half <= 0 || distance <= 0) return { x: 0, z: 0 };
  const sx = (cursor.x - width / 2) / half;
  const sz = (height / 2 - cursor.y) / half;
  const length = Math.hypot(sx, sz);
  const zone = Math.min(Math.max(deadZone, 0), 0.99);
  if (length <= zone) return { x: 0, z: 0 };
  const strength = (Math.min(length, 1) - zone) / (1 - zone);
  const scale = (strength * distance) / length;
  return rotateByYaw({ x: sx * scale, z: sz * scale }, yaw);
}

/**
 * How far to move from `current` toward a target this frame: exponential smoothing with time
 * constant `lag` seconds, independent of the frame rate. `lag <= 0` snaps.
 */
export function easeFactor(lag: number, dt: number): number {
  return lag <= 0 ? 1 : 1 - Math.exp(-dt / lag);
}

/**
 * Clamps `point` to `rect` shrunk by `inset` on every side (a negative inset grows it). An axis
 * where the shrunk rect is inverted (a room smaller than twice the inset) pins to its center.
 */
export function clampToRect(point: Vec2, rect: Rect, inset: number): Vec2 {
  const axis = (value: number, min: number, max: number) => {
    const lo = min + inset;
    const hi = max - inset;
    return lo > hi ? (min + max) / 2 : Math.min(Math.max(value, lo), hi);
  };
  return { x: axis(point.x, rect.minX, rect.maxX), z: axis(point.z, rect.minZ, rect.maxZ) };
}

export type CameraRigInput = {
  /** Where the camera follows (the player). */
  target: Vec2;
  /** The look-ahead offset to ease toward, or null to hold the current one (paused). */
  offset: Vec2 | null;
  /** The room to keep the look-at point in, or null for no clamp. */
  bounds: Rect | null;
  /** Follow lag in seconds (0 = pinned). */
  follow: number;
  /** Look-ahead lag in seconds. */
  lookAheadLag: number;
  /** Bounds inset in meters. */
  inset: number;
};

/** A target jump bigger than this in one frame (teleport, replay seek) snaps instead of easing. */
export const SNAP_DISTANCE = 2;

export type CameraRig = ReturnType<typeof createCameraRig>;

/**
 * The camera's follow state: a follow point easing toward the target, plus a look-ahead offset
 * easing toward the cursor's, clamped to the bounds after smoothing (so the clamp stays hard).
 * Starts snapped: the first update puts it right on the target.
 */
export function createCameraRig() {
  let follow: Vec2 = { x: 0, z: 0 };
  let offset: Vec2 = { x: 0, z: 0 };
  let lastTarget: Vec2 | null = null;

  return {
    /** Jumps straight to the target on the next update, with no look-ahead (loads, restarts). */
    snap(): void {
      lastTarget = null;
    },
    /** Advances by `dt` seconds of frame time and returns the point to look at. */
    update(input: CameraRigInput, dt: number): Vec2 {
      const { target } = input;
      const jumped =
        !lastTarget || Math.hypot(target.x - lastTarget.x, target.z - lastTarget.z) > SNAP_DISTANCE;
      lastTarget = { x: target.x, z: target.z };
      if (jumped) {
        follow = { x: target.x, z: target.z };
        offset = { x: 0, z: 0 };
      } else {
        const f = easeFactor(input.follow, dt);
        follow = {
          x: follow.x + (target.x - follow.x) * f,
          z: follow.z + (target.z - follow.z) * f,
        };
        if (input.offset) {
          const o = easeFactor(input.lookAheadLag, dt);
          offset = {
            x: offset.x + (input.offset.x - offset.x) * o,
            z: offset.z + (input.offset.z - offset.z) * o,
          };
        }
      }
      const at = { x: follow.x + offset.x, z: follow.z + offset.z };
      return input.bounds ? clampToRect(at, input.bounds, input.inset) : at;
    },
    /** The current (eased) look-ahead offset, for debug drawing. */
    get offset(): Vec2 {
      return offset;
    },
  };
}

/**
 * The edge-pan direction for a cursor at `cursor` (CSS pixels) in a `width`×`height` viewport, seen
 * by a camera with `yaw`: toward each screen edge the cursor is within `edge` pixels of (or past),
 * unit length (diagonal in a corner), turned into the world. Zero away from the edges. Screen up is
 * the camera's forward.
 */
export function edgePanDirection(
  cursor: { x: number; y: number },
  width: number,
  height: number,
  yaw: number,
  edge: number,
): Vec2 {
  const x = cursor.x <= edge ? -1 : cursor.x >= width - edge ? 1 : 0;
  const z = cursor.y <= edge ? 1 : cursor.y >= height - edge ? -1 : 0;
  if (x === 0 && z === 0) return { x: 0, z: 0 };
  const length = Math.hypot(x, z);
  return rotateByYaw({ x: x / length, z: z / length }, yaw);
}
