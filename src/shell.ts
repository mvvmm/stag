import type { Mesh, Scene } from "@babylonjs/core";
import { MAX_FRAME_DELTA, MAX_TICKS_PER_FRAME, TICK_HZ } from "@/core/constants";
import { createFixedLoop, type FixedLoop } from "@/core/loop";
import { createRng, type Rng } from "@/core/rng";
import { createWorld, type Entity } from "@/ecs/world";
import type { InputFrame, ShellFrame } from "@/input/actions";
import { attachInputDom, loadPreset, savePreset } from "@/input/dom";
import { createInputState, type InputState } from "@/input/state";
import { cameraYaw, createGroundAim } from "@/render/aim";
import { createEngine, fitCanvas } from "@/render/engine";
import { createMeshSync } from "@/render/meshSync";
import { createScene } from "@/render/scene";
import { createSimulation } from "@/systems/simulation";
import { loopStats } from "@/ui/signals";

const STATS_INTERVAL = 0.25;

export type Shell = {
  world: ReturnType<typeof createWorld>;
  rng: Rng;
  loop: FixedLoop;
  scene: Scene;
  input: InputState;
  /** The mesh mirroring an entity, if it has one. */
  meshOf(entity: Entity): Mesh | undefined;
  settings: { interpolate: boolean };
  /** Runs once per render frame with that frame's shell input (also while paused). */
  onFrame(listener: (frame: ShellFrame) => void): void;
  /** Runs once per simulation tick with the input the simulation saw. */
  onTick(listener: (input: InputFrame) => void): void;
  /** Pushes the current loop state to the UI now (e.g. after a key toggles something). */
  publishStats(): void;
};

/**
 * Wires the simulation, the fixed-step loop and the Babylon renderer together. This is the only
 * place that reads wall-clock time; the simulation only ever sees the fixed tick `dt`.
 */
export async function startShell(canvas: HTMLCanvasElement, seed: number): Promise<Shell> {
  const world = createWorld();
  const rng = createRng(seed);
  const simulation = createSimulation(world, rng);
  const input = createInputState(loadPreset());
  const frameListeners: ((frame: ShellFrame) => void)[] = [];
  const tickListeners: ((input: InputFrame) => void)[] = [];

  // The camera's yaw for this frame; WASD is relative to it. Updated before the loop runs.
  let yaw = 0;
  const loop = createFixedLoop({
    tickHz: TICK_HZ,
    maxFrameDelta: MAX_FRAME_DELTA,
    maxTicksPerFrame: MAX_TICKS_PER_FRAME,
    update: (dt) => {
      const tickInput = input.sampleTick(yaw);
      simulation.step(dt, tickInput);
      for (const listener of tickListeners) listener(tickInput);
    },
  });
  const settings = { interpolate: true };

  const engine = await createEngine(canvas);
  const scene = createScene(engine);
  const camera = scene.activeCamera;
  if (!camera) throw new Error("scene has no camera");
  const meshSync = createMeshSync(world, scene);
  const dom = attachInputDom(input, canvas);
  const groundAim = createGroundAim(scene, camera);

  // Auto-pause while the tab is hidden or the window is unfocused; independent of a manual pause.
  const updateAutoPause = () => {
    loop.autoPaused = document.hidden || !document.hasFocus();
    publishStats();
  };
  document.addEventListener("visibilitychange", updateAutoPause);
  window.addEventListener("blur", updateAutoPause);
  window.addEventListener("focus", updateAutoPause);

  let statsTimer = 0;
  let statsTicks = loop.tickCount;
  let tickRate = 0;
  const publishStats = () => {
    loopStats.value = {
      fps: Number.isFinite(engine.getFps()) ? Math.round(engine.getFps()) : 0,
      tickRate,
      alpha: loop.alpha,
      paused: loop.paused,
      autoPaused: loop.autoPaused,
      timeScale: loop.timeScale,
      interpolate: settings.interpolate,
    };
  };

  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const frameSeconds = (now - last) / 1000;
    last = now;

    fitCanvas(engine);
    // Aim is recomputed every frame: the camera can move even when the mouse doesn't.
    const pointer = dom.pointer;
    const aim = pointer && groundAim.project(pointer.x, pointer.y);
    if (aim) input.setAim(aim);
    yaw = cameraYaw(camera);

    const frame = input.sampleFrame();
    if (frame.pressed.has("pause")) {
      loop.paused = !loop.paused;
      publishStats();
    }
    if (frame.pressed.has("switchPreset")) {
      const next = input.preset.id === "mmo" ? "moba" : "mmo";
      input.setPreset(next);
      savePreset(next);
    }
    for (const listener of frameListeners) listener(frame);

    const { alpha } = loop.advance(frameSeconds);
    meshSync.sync(settings.interpolate ? alpha : 1);
    scene.render();

    statsTimer += frameSeconds;
    if (statsTimer >= STATS_INTERVAL) {
      tickRate = Math.round((loop.tickCount - statsTicks) / statsTimer);
      statsTicks = loop.tickCount;
      statsTimer = 0;
      publishStats();
    }
  });

  updateAutoPause();
  return {
    world,
    rng,
    loop,
    scene,
    input,
    meshOf: meshSync.meshOf,
    settings,
    onFrame: (listener) => frameListeners.push(listener),
    onTick: (listener) => tickListeners.push(listener),
    publishStats,
  };
}
