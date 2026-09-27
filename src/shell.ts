import type { Camera, Mesh, Scene, WebGPUEngine } from "@babylonjs/core";
import { MAX_FRAME_DELTA, MAX_TICKS_PER_FRAME, TICK_HZ } from "@/core/constants";
import { debugDraw } from "@/core/debugDraw";
import { createFixedLoop, type FixedLoop } from "@/core/loop";
import { createRng, type Rng } from "@/core/rng";
import { DEBUG } from "@/debug/enabled";
import type { FrameSample } from "@/debug/frameStats";
import { createWorld, type Entity } from "@/ecs/world";
import type { InputFrame, ShellFrame } from "@/input/actions";
import { attachInputDom, loadPreset } from "@/input/dom";
import { createInputState, type InputState } from "@/input/state";
import { cameraYaw, createGroundAim } from "@/render/aim";
import { createEngine, fitCanvas } from "@/render/engine";
import { createMeshSync } from "@/render/meshSync";
import { createScene, updateCamera } from "@/render/scene";
import { createSimulation } from "@/systems/simulation";
import { loopStats } from "@/ui/signals";

const STATS_INTERVAL = 0.25;

export type Shell = {
  world: ReturnType<typeof createWorld>;
  rng: Rng;
  loop: FixedLoop;
  engine: WebGPUEngine;
  scene: Scene;
  /** The camera the game aims and moves with (a debug camera may be rendering instead). */
  gameCamera: Camera;
  input: InputState;
  /** The mesh mirroring an entity, if it has one. */
  meshOf(entity: Entity): Mesh | undefined;
  settings: { interpolate: boolean };
  /** Starts the render loop. Call once the scene and tools are set up. */
  start(): void;
  /** Runs once per render frame with that frame's shell input (also while paused). */
  onFrame(listener: (frame: ShellFrame) => void): void;
  /** Runs once per simulation tick with the input the simulation saw. */
  onTick(listener: (input: InputFrame) => void): void;
  /** Adds a named, profiled step that runs each frame after mesh sync, right before rendering. */
  addRenderPhase(name: string, run: () => void): void;
  /** Runs at the end of every frame with its timings, for the profiler. */
  onFrameEnd(listener: (sample: FrameSample) => void): void;
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

  // Profiler: named timings for the current frame (systems summed over its ticks).
  let phases: Record<string, number> = {};
  const time = (name: string, run: () => void) => {
    const start = performance.now();
    run();
    phases[name] = (phases[name] ?? 0) + performance.now() - start;
  };

  const simulation = createSimulation(world, rng, undefined, { around: time });
  const input = createInputState(loadPreset());
  const frameListeners: ((frame: ShellFrame) => void)[] = [];
  const tickListeners: ((input: InputFrame) => void)[] = [];
  const renderPhases: { name: string; run: () => void }[] = [];
  const frameEndListeners: ((sample: FrameSample) => void)[] = [];

  // The camera's yaw for this frame; WASD is relative to it. Updated before the loop runs.
  let yaw = 0;
  const loop = createFixedLoop({
    tickHz: TICK_HZ,
    maxFrameDelta: MAX_FRAME_DELTA,
    maxTicksPerFrame: MAX_TICKS_PER_FRAME,
    update: (dt) => {
      const tickInput = input.sampleTick(yaw);
      debugDraw.beginTick(dt);
      simulation.step(dt, tickInput);
      debugDraw.endTick();
      for (const listener of tickListeners) listener(tickInput);
    },
  });
  const settings = { interpolate: true };

  const engine = await createEngine(canvas, { gpuTiming: DEBUG });
  const scene = createScene(engine);
  const camera = scene.activeCamera;
  if (!camera) throw new Error("scene has no camera");
  const meshSync = createMeshSync(world, scene);
  const dom = attachInputDom(input, canvas);
  const groundAim = createGroundAim(scene);

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

  const frame = (frameSeconds: number) => {
    const frameStart = performance.now();
    phases = {};

    fitCanvas(engine);
    updateCamera(camera);
    // Aim is recomputed every frame: the camera can move even when the mouse doesn't. It goes
    // through the rendering camera (the debug free camera, if on) so it's under the cursor; WASD
    // stays relative to the game camera.
    const pointer = dom.pointer;
    const aim = pointer && groundAim.project(pointer.x, pointer.y, scene.activeCamera ?? camera);
    if (aim) input.setAim(aim);
    yaw = cameraYaw(camera);

    const shellFrame = input.sampleFrame();
    if (shellFrame.pressed.has("pause")) {
      loop.paused = !loop.paused;
      publishStats();
    }
    for (const listener of frameListeners) listener(shellFrame);

    const { alpha } = loop.advance(frameSeconds);
    time("meshSync", () => meshSync.sync(settings.interpolate ? alpha : 1));
    for (const phase of renderPhases) time(phase.name, phase.run);
    time("render", () => scene.render());
    debugDraw.endFrame();

    const sample = {
      frameMs: frameSeconds * 1000,
      cpuMs: performance.now() - frameStart,
      phases,
    };
    for (const listener of frameEndListeners) listener(sample);

    statsTimer += frameSeconds;
    if (statsTimer >= STATS_INTERVAL) {
      tickRate = Math.round((loop.tickCount - statsTicks) / statsTimer);
      statsTicks = loop.tickCount;
      statsTimer = 0;
      publishStats();
    }
  };

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    let last = performance.now();
    engine.runRenderLoop(() => {
      const now = performance.now();
      const frameSeconds = (now - last) / 1000;
      last = now;
      frame(frameSeconds);
    });
    updateAutoPause();
  };

  return {
    world,
    rng,
    loop,
    engine,
    scene,
    gameCamera: camera,
    input,
    meshOf: meshSync.meshOf,
    settings,
    start,
    onFrame: (listener) => frameListeners.push(listener),
    onTick: (listener) => tickListeners.push(listener),
    addRenderPhase: (name, run) => renderPhases.push({ name, run }),
    onFrameEnd: (listener) => frameEndListeners.push(listener),
    publishStats,
  };
}
