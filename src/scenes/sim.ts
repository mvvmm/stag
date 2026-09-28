import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import type { NamedSystem } from "@/systems/simulation";

/**
 * A scene's simulation half: its systems and a `spawn` that fills a fresh world. Babylon-free, so
 * a scene runs headless (replay tests). The view half (`SceneDef.setup`) adds meshes and UI on
 * top and must not change the simulation.
 */
export type SceneSim = {
  /** Stable id, e.g. `arena`; used by `?scene=`, the debug settings and replay files. */
  id: string;
  label: string;
  /** Systems in run order (the transform snapshot always runs first). */
  systems: readonly NamedSystem[];
  /** Fills the world at tick 0. The only place besides systems that may use the RNG. */
  spawn(world: World<Entity>, rng: Rng): void;
};
