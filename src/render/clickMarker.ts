import { Color3, MeshBuilder, type Scene, StandardMaterial } from "@babylonjs/core";
import type { Vec2 } from "@/core/math";

/** Seconds the ring takes to grow to full size. */
const POP = 0.12;
/** Seconds it takes to fade out after popping. */
const FADE = 0.4;
const START_SCALE = 0.6;

/**
 * The click-to-move marker: a flat ring that pops and fades on the ground where a move order ends.
 * One reused mesh, animated on frame time (view-only). Call `update(seconds)` every frame.
 */
export function createClickMarker(scene: Scene) {
  const ring = MeshBuilder.CreateTorus(
    "clickMarker",
    { diameter: 0.7, thickness: 0.06, tessellation: 32 },
    scene,
  );
  ring.isPickable = false;
  ring.isVisible = false;
  const material = new StandardMaterial("clickMarker", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.45, 0.9, 1);
  ring.material = material;

  let age = Infinity;

  return {
    show(at: Vec2): void {
      ring.position.set(at.x, 0.04, at.z);
      age = 0;
    },

    update(seconds: number): void {
      age += seconds;
      const total = POP + FADE;
      ring.isVisible = age < total;
      if (!ring.isVisible) return;
      const grow = Math.min(1, age / POP);
      ring.scaling.setAll(START_SCALE + (1 - START_SCALE) * grow);
      ring.visibility = age < POP ? 1 : 1 - (age - POP) / FADE;
    },

    dispose(): void {
      ring.dispose();
      material.dispose();
    },
  };
}
