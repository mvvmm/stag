import {
  type AbstractEngine,
  type Camera,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";
import type { Vec3 } from "@/ecs/world";

/** The game camera. Smoothing, look-ahead and bounds come in 1.4. */
export const CAMERA = defineTunables("camera", {
  /** Angle above the ground, in degrees (90 = straight down). */
  pitch: { value: 52, min: 20, max: 89, step: 1 },
  /** Heading around the vertical, in degrees (0 looks north along +Z, walls line up with the screen). */
  yaw: { value: 0, min: -180, max: 180, step: 1 },
  /** Distance from the target. */
  distance: { value: 17.8, min: 5, max: 50, step: 0.1 },
  /** Vertical field of view, in degrees. */
  fov: { value: 46, min: 15, max: 100, step: 1 },
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

/** Scene, angled top-down camera and lights. Scenes add their own ground. */
export function createScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.04, 1);

  const camera = new UniversalCamera("camera", Vector3.Zero(), scene);
  updateCamera(camera, Vector3.Zero());

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.35;
  const sun = new DirectionalLight("sun", new Vector3(-1, -2, 1), scene);
  sun.intensity = 0.9;

  return scene;
}
