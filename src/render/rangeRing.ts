import { Color3, type Mesh, MeshBuilder, type Scene, StandardMaterial } from "@babylonjs/core";

/** sRGB: pale, like League's attack range circle. */
const COLOR = Color3.FromHexString("#cfd8e6");
const THICKNESS = 0.035;

/**
 * A thin ring on the ground showing a reach (the auto attack's, while an attack move is pending),
 * in the overlay scene so fog and post don't dim it.
 */
export function createRangeRing(scene: Scene) {
  const material = new StandardMaterial("rangeRing", scene);
  material.disableLighting = true;
  material.emissiveColor = COLOR.toLinearSpace();
  material.alpha = 0.8;
  let ring: Mesh | null = null;
  let built = 0;
  /** Built for a radius (rebuilt when it changes: scaling a torus would thicken its line). */
  const ringFor = (radius: number): Mesh => {
    if (ring && built === radius) return ring;
    ring?.dispose();
    ring = MeshBuilder.CreateTorus(
      "rangeRing",
      { diameter: radius * 2, thickness: THICKNESS, tessellation: 96 },
      scene,
    );
    ring.isPickable = false;
    ring.material = material;
    built = radius;
    return ring;
  };
  return {
    /** Shows the ring round `at` with `radius` (m), or hides it (null). */
    show(at: { x: number; z: number } | null, radius = 1): void {
      if (!at) {
        ring?.setEnabled(false);
        return;
      }
      const mesh = ringFor(radius);
      mesh.setEnabled(true);
      mesh.position.set(at.x, 0.035, at.z);
    },
    dispose(): void {
      ring?.dispose();
      material.dispose();
    },
  };
}
