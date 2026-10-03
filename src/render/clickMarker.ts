import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import type { Vec2 } from "@/core/math";

/** Seconds the ring takes to grow to full size. */
const POP = 0.12;
/** Seconds it takes to fade out after popping. */
const FADE = 0.4;
const START_SCALE = 0.6;
const DIAMETER = 0.7;
/** The chevron: how far out from the ring's center (m), and its size (m). */
const CHEVRON_AT = DIAMETER / 2 + 0.22;
const CHEVRON_ARM = 0.26;
const CHEVRON_WIDTH = 0.07;

/** sRGB colors: a move order's marker, and an attack move's. */
export const MOVE_MARKER = new Color3(0.45, 0.9, 1);
export const ATTACK_MARKER = Color3.FromHexString("#e2483a");

/**
 * The click marker: a flat ring that pops and fades on the ground where an order lands (blue for a
 * move, red for an attack move). Given something to point at, a chevron on the ring's edge points
 * at it (the enemy an attack move picked) and keeps pointing while it moves. One reused mesh,
 * animated on frame time (view-only). Call `update(seconds)` every frame.
 */
export function createClickMarker(scene: Scene, color: Color3 = MOVE_MARKER) {
  const root = new TransformNode("clickMarker", scene);
  const ring = MeshBuilder.CreateTorus(
    "clickMarkerRing",
    { diameter: DIAMETER, thickness: 0.06, tessellation: 32 },
    scene,
  );
  ring.parent = root;
  ring.isPickable = false;
  const material = new StandardMaterial("clickMarker", scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  ring.material = material;

  // The chevron: two bars in a ">" pointing along the pivot's +Z, out past the ring.
  const pivot = new TransformNode("clickMarkerChevron", scene);
  pivot.parent = root;
  const chevron = new Mesh("clickMarkerChevronArms", scene);
  chevron.parent = pivot;
  for (const sign of [1, -1]) {
    const arm = MeshBuilder.CreateBox(
      "clickMarkerChevronArm",
      { width: CHEVRON_WIDTH, height: 0.01, depth: CHEVRON_ARM },
      scene,
    );
    arm.material = material;
    arm.isPickable = false;
    // Each arm runs from the tip back and out to one side (a box's long axis is its Z, turned by
    // rotation.y toward +X).
    arm.rotation.y = -sign * 0.75;
    arm.position.set(
      sign * Math.sin(0.75) * (CHEVRON_ARM / 2),
      0,
      -Math.cos(0.75) * (CHEVRON_ARM / 2),
    );
    arm.parent = chevron;
  }
  chevron.position.z = CHEVRON_AT;
  chevron.isPickable = false;

  root.setEnabled(false);
  let age = Infinity;
  let toward: (() => Vec2 | null) | null = null;

  return {
    /** Pops the marker at `at`, with a chevron pointing at whatever `target` returns (if given). */
    show(at: Vec2, target: (() => Vec2 | null) | null = null): void {
      root.position.set(at.x, 0.04, at.z);
      toward = target;
      age = 0;
    },

    update(seconds: number): void {
      age += seconds;
      const total = POP + FADE;
      const shown = age < total;
      root.setEnabled(shown);
      if (!shown) return;
      const grow = Math.min(1, age / POP);
      root.scaling.setAll(START_SCALE + (1 - START_SCALE) * grow);
      const visibility = age < POP ? 1 : 1 - (age - POP) / FADE;
      ring.visibility = visibility;
      const point = toward?.() ?? null;
      const dx = point ? point.x - root.position.x : 0;
      const dz = point ? point.z - root.position.z : 0;
      // No target, or standing on it: no chevron.
      const aims = point !== null && Math.hypot(dx, dz) > CHEVRON_AT;
      pivot.setEnabled(aims);
      if (aims) {
        pivot.rotation.y = Math.atan2(dx, dz);
        for (const arm of chevron.getChildMeshes()) arm.visibility = visibility;
      }
    },

    dispose(): void {
      root.dispose(false, false);
      material.dispose();
    },
  };
}
