import { type AbstractMesh, type Camera, Ray, type Scene, Vector3 } from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";
import type { Vec3 } from "@/ecs/world";

/** Obstacles that hide the focus (the player) fade out while they do. View-only. */
export const OCCLUSION = defineTunables("occlusion", {
  enabled: { value: true },
  /** Visibility of an obstacle while it hides the focus (0 = invisible, 1 = solid). */
  alpha: { value: 0.25, min: 0, max: 1, step: 0.05 },
  /** Seconds to fade fully out or back in. */
  fade: { value: 0.15, min: 0, max: 1, step: 0.01 },
});

/** Where on the focus the rays aim, relative to its position: center, head, and both sides. */
const PROBE_HEIGHTS = [0.3, 1.2];
const PROBE_SIDE = 0.35;

/**
 * Fades `meshes` that stand between the game camera and `focus()` (a few rays from the camera to
 * points on the focus). Call `update(seconds)` once per frame, after the camera is placed. While
 * another camera renders (the debug free camera) everything shows solid.
 */
export function createOcclusionFader(
  scene: Scene,
  camera: Camera,
  meshes: readonly AbstractMesh[],
  focus: () => Vec3 | null,
) {
  const ray = new Ray(Vector3.Zero(), Vector3.Forward());
  const target = new Vector3();
  const side = new Vector3();
  const hiding = new Set<AbstractMesh>();

  const probe = (origin: Vector3, point: Vector3) => {
    const toPoint = point.subtract(origin);
    const length = toPoint.length();
    if (length < 1e-6) return;
    ray.origin.copyFrom(origin);
    ray.direction.copyFrom(toPoint.scaleInPlace(1 / length));
    ray.length = length;
    for (const mesh of meshes) {
      if (!hiding.has(mesh) && ray.intersectsMesh(mesh, false).hit) hiding.add(mesh);
    }
  };

  return {
    update(seconds: number): void {
      hiding.clear();
      const at = OCCLUSION.enabled && scene.activeCamera === camera ? focus() : null;
      if (at) {
        const origin = camera.position;
        // Sideways relative to the view, so the probes cover the focus's width on screen.
        target.set(at.x - origin.x, 0, at.z - origin.z);
        side.set(target.z, 0, -target.x);
        if (side.lengthSquared() > 1e-9) side.normalize().scaleInPlace(PROBE_SIDE);
        for (const height of PROBE_HEIGHTS) {
          const center = new Vector3(at.x, height, at.z);
          probe(origin, center);
          probe(origin, center.add(side));
          probe(origin, center.subtract(side));
        }
      }

      // A full fade (solid ↔ alpha) takes `fade` seconds.
      const range = Math.max(1 - OCCLUSION.alpha, 0.05);
      const step = OCCLUSION.fade > 0 ? (range * seconds) / OCCLUSION.fade : 1;
      for (const mesh of meshes) {
        const goal = hiding.has(mesh) ? OCCLUSION.alpha : 1;
        const delta = goal - mesh.visibility;
        mesh.visibility =
          Math.abs(delta) <= step ? goal : mesh.visibility + Math.sign(delta) * step;
      }
    },
  };
}
