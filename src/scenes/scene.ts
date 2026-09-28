import type { AbstractMesh, Camera, Mesh, Scene } from "@babylonjs/core";
import type { World } from "miniplex";
import type { Disposable } from "@/core/disposer";
import type { Entity, Vec3 } from "@/ecs/world";
import type { InputFrame, ShellFrame } from "@/input/actions";
import type { InputState } from "@/input/state";
import type { Rect } from "@/render/cameraRig";
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
  /** The camera the game aims and moves with (a debug camera may be rendering instead). */
  readonly camera: Camera;
  readonly input: InputState;
  /** The mesh mirroring an entity, if it has one. */
  meshOf(entity: Entity): Mesh | undefined;
  /**
   * Links a mesh the scene built itself (e.g. a static obstacle) to its entity, so `meshOf` and
   * picking know it. For an entity with a transform it replaces the placeholder box and follows the
   * entity (so its origin is the entity's position). Dispose the mesh with `own` as usual; the link
   * goes with the scene.
   */
  bindMesh(entity: Entity, mesh: Mesh): void;
  /**
   * What the game camera looks at, read every frame after mesh sync (so an entity's mesh position
   * is already interpolated). Without one, the camera looks at the origin.
   */
  setCameraTarget(target: () => Vec3): void;
  /**
   * The ground rect the camera's look-at point stays in (inset by the `camera.boundsInset`
   * tunable), or null for none (the default).
   */
  setCameraBounds(bounds: Rect | null): void;
  /**
   * A scene drawn on top of the game after post-processing, through the same camera: for markers
   * that must keep their true colors (no lighting, fog, grading or bloom). Meshes built in it are
   * still owned with `own`.
   */
  readonly overlay: Scene;
  /**
   * The meshes that cast moon shadows (children included); the shadow frustum is fit to their
   * bounds once, so include the room's walls. Receivers set `receiveShadows` themselves.
   */
  setShadowCasters(meshes: readonly AbstractMesh[]): void;
  /**
   * What the player's warm light hangs over, read every frame. Without one there's no such light.
   * `exclude` lists meshes it doesn't light (children included), e.g. the body right under it.
   */
  setLightTarget(target: () => Vec3, options?: { exclude?: readonly AbstractMesh[] }): void;
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
