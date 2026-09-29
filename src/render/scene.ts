import {
  type AbstractEngine,
  type Camera,
  Color4,
  Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";
import type { Vec3 } from "@/ecs/world";

/** The game camera: placement, cursor look-ahead, follow and bounds (see `cameraRig.ts`). */
export const CAMERA = defineTunables("camera", {
  /** Angle above the ground, in degrees (90 = straight down). */
  pitch: { value: 52, min: 20, max: 89, step: 1 },
  /** Heading around the vertical, in degrees (0 looks north along +Z, walls line up with the screen). */
  yaw: { value: 0, min: -180, max: 180, step: 1 },
  /** Distance from the target. */
  distance: { value: 17.8, min: 5, max: 50, step: 0.1 },
  /** Vertical field of view, in degrees. */
  fov: { value: 46, min: 15, max: 100, step: 1 },
  /** How far the view leans toward the cursor, in meters (0 = off). */
  lookAhead: { value: 3, min: 0, max: 8, step: 0.1 },
  /** Fraction of the half-screen around the center where the cursor gives no look-ahead. */
  deadZone: { value: 0.15, min: 0, max: 0.9, step: 0.01 },
  /** Time constant of the look-ahead easing, in seconds. */
  lookAheadLag: { value: 0.25, min: 0, max: 1, step: 0.01 },
  /** Time constant of the player follow, in seconds (0 = pinned). */
  follow: { value: 0, min: 0, max: 0.5, step: 0.01 },
  /** Keep the look-at point inside the room. */
  bounds: { value: true },
  /** How far inside the room's edges the look-at point stops, in meters (negative = past them). */
  boundsInset: { value: 4, min: -10, max: 15, step: 0.1 },
  /** moba: the camera is free and pans while the cursor is at a screen edge, at this many m/s. */
  edgePanSpeed: { value: 18, min: 0, max: 60, step: 0.5 },
  /** moba: how close to a screen edge the cursor pans, in CSS pixels. */
  edgePanSize: { value: 12, min: 1, max: 100, step: 1 },
});

const lookAt = new Vector3();

/**
 * Places the game camera from the `camera` tunables, looking at `target` from `distance` away,
 * `pitch` above the ground and facing along `yaw`. Call every frame right before rendering.
 */
export function updateCamera(camera: Camera, target: Vec3): void {
  const pitch = (CAMERA.pitch * Math.PI) / 180;
  const yaw = (CAMERA.yaw * Math.PI) / 180;
  const flat = Math.cos(pitch) * CAMERA.distance;
  camera.position.set(
    target.x - Math.sin(yaw) * flat,
    target.y + Math.sin(pitch) * CAMERA.distance,
    target.z - Math.cos(yaw) * flat,
  );
  camera.fov = (CAMERA.fov * Math.PI) / 180;
  if (camera instanceof UniversalCamera) camera.setTarget(lookAt.set(target.x, target.y, target.z));
}

/** Scene and angled top-down camera. The atmosphere rig adds lights; scenes add their own ground. */
export function createScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.04, 1);

  const camera = new UniversalCamera("camera", Vector3.Zero(), scene);
  updateCamera(camera, Vector3.Zero());

  return scene;
}
