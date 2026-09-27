import { type Camera, Ray, type Scene, Vector3 } from "@babylonjs/core";
import { GROUND_Y } from "@/core/constants";
import { rayToGround, type Vec2 } from "@/core/math";

/**
 * Projects a pointer position (CSS pixels relative to the canvas) onto the ground plane through a
 * camera. Babylon's picking ray applies our hardware scaling, so CSS pixels go in as-is.
 */
export function createGroundAim(scene: Scene) {
  const ray = new Ray(Vector3.Zero(), Vector3.Forward());
  return {
    /** Pass the camera that's rendering, so the point matches what's under the cursor. */
    project(x: number, y: number, camera: Camera): Vec2 | null {
      scene.createPickingRayToRef(x, y, null, ray, camera);
      return rayToGround(ray.origin, ray.direction, GROUND_Y);
    },
  };
}

/** The camera's heading around +Y (0 looks along +Z), for camera-relative movement. */
export function cameraYaw(camera: Camera): number {
  const forward = camera.getDirection(Vector3.Forward());
  return Math.atan2(forward.x, forward.z);
}
