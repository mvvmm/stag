import type { Mesh, Scene } from "@babylonjs/core";
import type { World } from "miniplex";
import type { Disposable } from "@/core/disposer";
import type { Entity } from "@/ecs/world";
import type { InputFrame, ShellFrame } from "@/input/actions";
import type { InputState } from "@/input/state";
import type { SceneSim } from "@/scenes/sim";

/**
 * A scene: its simulation half (`SceneSim`: systems + `spawn`) plus a view `setup` that adds
 * meshes, materials and UI once the world is spawned. The shell tears the scene down and runs
 * `spawn` and `setup` again on every load, reset and restart, so setup must build everything
 * through the context (which cleans up after it) and must not keep state between runs. Setup is
 * view-only: it must not change the simulation (a headless replay never runs it).
 */
export type SceneDef = SceneSim & {
  setup(ctx: SceneContext): void;
};

/**
 * What a scene's setup gets. Everything registered through it (listeners, render hooks, owned
 * meshes and materials) is cleaned up when the scene is torn down, newest first. Entities need no
 * cleanup: each load gets a fresh world.
 */
export type SceneContext = {
  /** The freshly spawned world, to read (view-only: don't change it). */
  readonly world: World<Entity>;
  readonly seed: number;
  readonly scene: Scene;
  readonly input: InputState;
  /** The mesh mirroring an entity, if it has one. */
  meshOf(entity: Entity): Mesh | undefined;
  /** Disposes `thing` (a mesh, material, …) at teardown and returns it. */
  own<T extends Disposable>(thing: T): T;
  /** Runs `cleanup` at teardown. */
  onDispose(cleanup: () => void): void;
  /** Once per simulation tick, with the input the simulation saw. */
  onTick(listener: (input: InputFrame) => void): void;
  /** Once per render frame with that frame's shell input (also while paused). */
  onFrame(listener: (frame: ShellFrame) => void): void;
  /** Right before the scene renders, every frame. */
  onBeforeRender(run: () => void): void;
  /** When a tunable changes (the id), or null when tunable groups were (re)defined. */
  onTunableChange(listener: (id: string | null) => void): void;
  /** Restarts this scene with the same seed (deferred to the end of the frame if one is running). */
  restart(): void;
};
