import type { Camera, Mesh, Scene, WebGPUEngine } from "@babylonjs/core";
import type { World } from "miniplex";
import { MAX_FRAME_DELTA, MAX_TICKS_PER_FRAME, TICK_HZ } from "@/core/constants";
import { debugDraw } from "@/core/debugDraw";
import { createDisposer, type Disposer } from "@/core/disposer";
import { createFixedLoop, type FixedLoop } from "@/core/loop";
import { createRng, type Rng } from "@/core/rng";
import { tuning } from "@/core/tuning";
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
import type { SceneContext, SceneDef } from "@/scenes/scene";
import { createSimulation } from "@/systems/simulation";
import { loopStats } from "@/ui/signals";

const STATS_INTERVAL = 0.25;

/** The scene that's running and the seed it was loaded with. */
export type LoadedScene = { def: SceneDef; seed: number };

export type Shell = {
  /** The current scene's world. A new one on every load, so don't keep it around. */
  readonly world: World<Entity>;
  /** The current scene's RNG, seeded on every load. */
  readonly rng: Rng;
  loop: FixedLoop;
  engine: WebGPUEngine;
  scene: Scene;
  /** The camera the game aims and moves with (a debug camera may be rendering instead). */
  gameCamera: Camera;
  input: InputState;
  /** The running scene and its seed; null before the first load. */
  readonly current: LoadedScene | null;
  /**
   * Tears the current scene down (listeners, owned meshes, the world) and sets `def` up in a
   * fresh world with an RNG seeded with `seed`, at tick 0. Pause and time scale are kept. Called
   * during a frame (e.g. from a tick listener), it waits until the frame has ended.
   */
  load(def: SceneDef, seed: number): void;
  /** Loads the current scene again, with the same seed or the given one. */
  restart(seed?: number): void;
  /** Runs one simulation tick now, even while paused (frame step). */
  step(): void;
  /** Runs after every load, once the scene is set up. Returns an unsubscribe function. */
  onLoad(listener: (loaded: LoadedScene) => void): () => void;
  /** The mesh mirroring an entity, if it has one. */
  meshOf(entity: Entity): Mesh | undefined;
  /** The entity a mesh mirrors, if any (for picking). */
  entityOf(mesh: Mesh): Entity | undefined;
  settings: { interpolate: boolean };
  /** Starts the render loop. Call once the scene and tools are set up. */
  start(): void;
  /** Runs once per render frame with that frame's shell input (also while paused). */
  onFrame(listener: (frame: ShellFrame) => void): () => void;
  /** Runs once per simulation tick with the input the simulation saw. */
  onTick(listener: (input: InputFrame) => void): () => void;
  /** Adds a named, profiled step that runs each frame after mesh sync, right before rendering. */
  addRenderPhase(name: string, run: () => void): void;
  /** Runs at the end of every frame with its timings, for the profiler. */
  onFrameEnd(listener: (sample: FrameSample) => void): void;
  /** Pushes the current loop state to the UI now (e.g. after a key toggles something). */
  publishStats(): void;
};

/** A fresh uint32 seed from the wall clock (the shell is the only place allowed to read it). */
export function randomSeed(): number {
  return (Date.now() ^ (performance.now() * 1000) ^ (Math.random() * 0x100000000)) >>> 0;
}

/** Adds a listener to a set and returns a function that removes it. */
const listen = <T>(set: Set<T>, listener: T) => {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
};

/**
 * Wires the simulation, the fixed-step loop and the Babylon renderer together. This is the only
 * place that reads wall-clock time; the simulation only ever sees the fixed tick `dt`.
 */
export async function startShell(canvas: HTMLCanvasElement): Promise<Shell> {
  // Profiler: named timings for the current frame (systems summed over its ticks).
  let phases: Record<string, number> = {};
  const time = (name: string, run: () => void) => {
    const start = performance.now();
    run();
    phases[name] = (phases[name] ?? 0) + performance.now() - start;
  };

  const input = createInputState(loadPreset());
  const frameListeners = new Set<(frame: ShellFrame) => void>();
  const tickListeners = new Set<(input: InputFrame) => void>();
  const loadListeners = new Set<(loaded: LoadedScene) => void>();
  const renderPhases: { name: string; run: () => void }[] = [];
  const frameEndListeners: ((sample: FrameSample) => void)[] = [];

  // Per-load state: replaced wholesale by `load`. Until the first load there's an empty world
  // running no systems.
  let world = createWorld();
  let rng = createRng(0);
  let simulation = createSimulation(world, rng, [], { around: time });
  let current: (LoadedScene & { disposer: Disposer }) | null = null;

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
  let meshSync = createMeshSync(world, scene);
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

  const doLoad = (def: SceneDef, seed: number) => {
    if (current) {
      try {
        current.disposer.dispose();
      } catch (error) {
        console.error(`tearing down scene "${current.def.id}" failed`, error);
      }
    }
    meshSync.dispose();

    world = createWorld();
    rng = createRng(seed);
    simulation = createSimulation(world, rng, def.systems, { around: time });
    meshSync = createMeshSync(world, scene);
    loop.reset();
    input.resetEdges();
    debugDraw.clear();
    statsTicks = 0;

    const disposer = createDisposer();
    const loaded = { def, seed, disposer };
    current = loaded;
    const ctx: SceneContext = {
      world,
      rng,
      seed,
      scene,
      input,
      meshOf: meshSync.meshOf,
      own: disposer.own,
      onDispose: disposer.add,
      onTick: (listener) => disposer.add(listen(tickListeners, listener)),
      onFrame: (listener) => disposer.add(listen(frameListeners, listener)),
      onBeforeRender: (run) => {
        const observer = scene.onBeforeRenderObservable.add(run);
        disposer.add(() => scene.onBeforeRenderObservable.remove(observer));
      },
      onTunableChange: (listener) => disposer.add(tuning.onChange(listener)),
      restart: () => {
        // Only while this run is the current one (a stale context can't restart anything).
        if (current === loaded) load(def, seed);
      },
    };
    def.setup(ctx);
    console.info(`scene ${def.id} seed ${seed}`);
    for (const listener of loadListeners) listener({ def, seed });
  };

  // Loads requested mid-frame (from a tick or frame listener) wait for the frame to end, so a
  // frame never runs half in one world and half in the next.
  let inFrame = false;
  let pendingLoad: LoadedScene | null = null;
  const load = (def: SceneDef, seed: number) => {
    if (inFrame) pendingLoad = { def, seed };
    else doLoad(def, seed);
  };

  const frame = (frameSeconds: number) => {
    const frameStart = performance.now();
    phases = {};
    inFrame = true;

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
    inFrame = false;
    if (pendingLoad) {
      const { def, seed } = pendingLoad;
      pendingLoad = null;
      doLoad(def, seed);
    }
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
    get world() {
      return world;
    },
    get rng() {
      return rng;
    },
    loop,
    engine,
    scene,
    gameCamera: camera,
    input,
    get current() {
      return current && { def: current.def, seed: current.seed };
    },
    load,
    restart(seed) {
      if (!current) throw new Error("no scene loaded");
      load(current.def, seed ?? current.seed);
    },
    step() {
      loop.step();
      publishStats();
    },
    onLoad: (listener) => listen(loadListeners, listener),
    meshOf: (entity) => meshSync.meshOf(entity),
    entityOf: (mesh) => meshSync.entityOf(mesh),
    settings,
    start,
    onFrame: (listener) => listen(frameListeners, listener),
    onTick: (listener) => listen(tickListeners, listener),
    addRenderPhase: (name, run) => renderPhases.push({ name, run }),
    onFrameEnd: (listener) => frameEndListeners.push(listener),
    publishStats,
  };
}
