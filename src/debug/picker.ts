import type { AbstractMesh, Mesh } from "@babylonjs/core";
import type { Entity } from "@/ecs/world";
import type { Shell } from "@/shell";

/** A press and release closer than this (CSS pixels) is a click; farther is a drag (free camera). */
const CLICK_SLOP = 4;
const OWNER = "picker";

/**
 * Entity picking in the world. While active it borrows the mouse buttons from the game (like the
 * free camera), tracks the entity under the cursor (`hovered`, updated once per frame), and a
 * left click selects the entity whose mesh is under the cursor, or nothing. It picks through the
 * camera that's rendering, so it works with the free camera too.
 */
export function createPicker(shell: Shell, onPick: (entity: Entity | null) => void) {
  const { scene, input } = shell;
  const canvas = shell.engine.getRenderingCanvas() as HTMLCanvasElement;
  let active = false;
  let pressedAt: { x: number; y: number } | null = null;
  /** Cursor over the canvas (CSS pixels), or null when it's elsewhere. */
  let pointer: { x: number; y: number } | null = null;
  let hovered: Entity | null = null;

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const isEntityMesh = (mesh: AbstractMesh) => shell.entityOf(mesh as Mesh) !== undefined;

  const entityAt = (at: { x: number; y: number }): Entity | null => {
    const hit = scene.pick(at.x, at.y, isEntityMesh, false, scene.activeCamera);
    const mesh = hit?.pickedMesh as Mesh | null | undefined;
    return (mesh && shell.entityOf(mesh)) ?? null;
  };

  window.addEventListener("pointermove", (event) => {
    pointer = event.target === canvas ? local(event) : null;
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });
  window.addEventListener("pointerdown", (event) => {
    if (!active || event.button !== 0 || event.target !== canvas) return;
    pressedAt = local(event);
  });
  window.addEventListener("pointerup", (event) => {
    if (!active || event.button !== 0 || !pressedAt) return;
    const at = local(event);
    const moved = Math.hypot(at.x - pressedAt.x, at.y - pressedAt.y);
    pressedAt = null;
    if (moved <= CLICK_SLOP) onPick(entityAt(at));
  });

  // Meshes move under a still cursor, so hover is re-picked every frame (only while picking).
  shell.addRenderPhase("picker", () => {
    hovered = active && pointer ? entityAt(pointer) : null;
  });

  return {
    get active(): boolean {
      return active;
    },
    set active(on: boolean) {
      active = on;
      pressedAt = null;
      if (!on) hovered = null;
      input.borrowMouse(OWNER, on);
    },
    /** The entity under the cursor while picking, else null. */
    get hovered(): Entity | null {
      return hovered;
    },
  };
}
