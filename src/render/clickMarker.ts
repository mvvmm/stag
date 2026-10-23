import {
  Color3,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Vec2 } from "@/core/math";

/** Seconds the ring takes to grow to full size. */
const POP = 0.12;
/** Seconds it takes to fade out after popping. */
const FADE = 0.4;
const START_SCALE = 0.6;
const DIAMETER = 0.7;
/** The chevron: how far out from the ring's center its tip is (m), its half width and depth (m),
 * and the thickness of its stroke (m). */
const CHEVRON_AT = DIAMETER / 2 + 0.16;
const CHEVRON_HALF_WIDTH = 0.08;
const CHEVRON_DEPTH = 0.08;
const CHEVRON_STROKE = 0.03;
/** How pointed the tip is: 1 = a sharp V, higher = rounder. */
const CHEVRON_ROUND = 1.5;

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

  // The chevron: one soft stroke, a "^" pointing along the pivot's +Z with a rounded tip and
  // gently curved arms, round at both ends.
  const pivot = new TransformNode("clickMarkerChevron", scene);
  pivot.parent = root;
  const chevron = new Mesh("clickMarkerChevronArms", scene);
  chevron.parent = pivot;
  const path: Vector3[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // From one arm's end to the other's: back by |x|^round from the tip.
    const u = 2 * t - 1;
    const x = u * CHEVRON_HALF_WIDTH;
    const z = -CHEVRON_DEPTH * Math.abs(u) ** CHEVRON_ROUND;
    path.push(new Vector3(x, 0, z));
  }
  const stroke = MeshBuilder.CreateTube(
    "clickMarkerChevronStroke",
    { path, radius: CHEVRON_STROKE / 2, tessellation: 8 },
    scene,
  );
  stroke.parent = chevron;
  for (const end of [path[0], path[path.length - 1]]) {
    const cap = MeshBuilder.CreateSphere(
      "clickMarkerChevronCap",
      { diameter: CHEVRON_STROKE, segments: 6 },
      scene,
    );
    cap.position.copyFrom(end as Vector3);
    cap.parent = chevron;
  }
  for (const part of chevron.getChildMeshes()) {
    part.material = material;
    part.isPickable = false;
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
