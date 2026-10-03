import type { Camera, Mesh, Scene, WebGPUEngine } from "@babylonjs/core";
import type { World } from "miniplex";
import { MAX_FRAME_DELTA, MAX_TICKS_PER_FRAME, TICK_HZ } from "@/core/constants";
import { debugDraw } from "@/core/debugDraw";
import { createDisposer, type Disposer } from "@/core/disposer";
import { createFixedLoop, type FixedLoop } from "@/core/loop";
import type { Vec2 } from "@/core/math";
import { createRng, type Rng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { DEBUG } from "@/debug/enabled";
import type { FrameSample } from "@/debug/frameStats";
import { createWorld, type Entity, type Vec3 } from "@/ecs/world";
import type { InputFrame, ShellFrame } from "@/input/actions";
import { PRESETS, type PresetId } from "@/input/bindings";
import { attachInputDom, loadPreset, savePreset } from "@/input/dom";
import { createInputState, type InputState } from "@/input/state";
import { cameraYaw, createGroundAim, createHoverPick } from "@/render/aim";
import { type Atmosphere, createAtmosphere } from "@/render/atmosphere";
import {
  clampToRect,
  createCameraRig,
  edgePanDirection,
  lookAheadOffset,
  type Rect,
} from "@/render/cameraRig";
import { createEngine, fitCanvas } from "@/render/engine";
import { createMeshSync } from "@/render/meshSync";
import { preloadModels } from "@/render/models";
import { CAMERA, createScene, updateCamera } from "@/render/scene";
import type { SceneContext, SceneDef } from "@/scenes/scene";
import { createSimulation } from "@/systems/simulation";
import { loopStats, menuActions, pauseMenu, showNotice } from "@/ui/signals";
import { createSoftwareCursor } from "@/ui/softwareCursor";

const STATS_INTERVAL = 0.25;

/** The scene that's running and the seed it was loaded with. */
export type LoadedScene = { def: SceneDef; seed: number };

export type LoadOptions = {
  /** Fills the fresh world instead of `def.spawn` (e.g. restoring a replay snapshot). */
  spawn?: (world: World<Entity>, rng: Rng) => void;
};

/**
 * Takes over the simulation's input (replay playback): `input` gets the tick's index and the live
 * input (sampled anyway, so no stale presses are left over when it lets go) and returns what the
 * simulation sees. While `canTick` is false, no tick runs, not even a frame step.
 */
export type TickDriver = {
  input(tick: number, live: InputFrame): InputFrame;
  canTick(): boolean;
};

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
  /** Lights, shadows, fog and post-processing, shared by every scene; and the overlay scene. */
  atmosphere: Atmosphere;
  input: InputState;
  /** The running scene and its seed; null before the first load. */
  readonly current: LoadedScene | null;
  /**
   * Tears the current scene down (listeners, owned meshes, the world) and sets `def` up in a
   * fresh world with an RNG seeded with `seed`, at tick 0. Pause and time scale are kept. Called
   * during a frame (e.g. from a tick listener), it waits until the frame has ended. `spawn`
   * replaces the scene's own spawn (a replay restoring a mid-run snapshot).
   */
  load(def: SceneDef, seed: number, options?: LoadOptions): void;
  /** Loads the current scene again, with the same seed or the given one. */
  restart(seed?: number): void;
  /** Runs one simulation tick now, even while paused (frame step). */
  step(): void;
  /** Runs after every load, once the scene is set up. Returns an unsubscribe function. */
  onLoad(listener: (loaded: LoadedScene) => void): () => void;
  /**
   * Runs at the start of every load, before the old scene is torn down and the new one spawns
   * (e.g. to set tunables that `spawn` reads). Returns an unsubscribe function.
   */
  onBeforeLoad(listener: (loaded: LoadedScene) => void): () => void;
  /** Hands the simulation's input to a driver (replay playback), or back to the player (null). */
  setTickDriver(driver: TickDriver | null): void;
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
  const beforeLoadListeners = new Set<(loaded: LoadedScene) => void>();
  let driver: TickDriver | null = null;
  const renderPhases: { name: string; run: () => void }[] = [];
  const frameEndListeners: ((sample: FrameSample) => void)[] = [];

  // Per-load state: replaced wholesale by `load`. Until the first load there's an empty world
  // running no systems.
  let world = createWorld();
  let rng = createRng(0);
  let simulation = createSimulation(world, rng, [], { around: time });
  let current: (LoadedScene & { disposer: Disposer }) | null = null;
  const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
  let cameraTarget = (): Vec3 => ORIGIN;
  let cameraBounds: Rect | null = null;
  const cameraRig = createCameraRig();
  /**
   * moba: where the free camera looks (it pans at the screen edges and Space brings it back to the
   * player, like League); null while it follows the player (WASD, or before the first frame).
   */
  let freeLook: Vec2 | null = null;

  // The camera's yaw for this frame; WASD is relative to it. Updated before the loop runs.
  let yaw = 0;
  const loop = createFixedLoop({
    tickHz: TICK_HZ,
    maxFrameDelta: MAX_FRAME_DELTA,
    maxTicksPerFrame: MAX_TICKS_PER_FRAME,
    update: (dt) => {
      const live = input.sampleTick(yaw);
      const tickInput = driver ? driver.input(loop.tickCount, live) : live;
      debugDraw.beginTick(dt);
      simulation.step(dt, tickInput);
      debugDraw.endTick();
      for (const listener of tickListeners) listener(tickInput);
    },
    canTick: () => !driver || driver.canTick(),
  });
  const settings = { interpolate: true };

  const engine = await createEngine(canvas, { gpuTiming: DEBUG });
  const scene = createScene(engine);
  const camera = scene.activeCamera;
  if (!camera) throw new Error("scene has no camera");
  // Before mesh sync builds its material, so the rig's material plugins apply to it.
  const atmosphere = createAtmosphere(scene, camera);
  let meshSync = createMeshSync(world, scene);
  // After the rig too (its plugins apply to the models' materials), before the first scene.
  await preloadModels(scene);
  const dom = attachInputDom(input, canvas);
  const cursor = createSoftwareCursor(canvas);
  const groundAim = createGroundAim(scene);
  const hoverPick = createHoverPick(scene);

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

  const doLoad = (def: SceneDef, seed: number, options: LoadOptions = {}) => {
    for (const listener of beforeLoadListeners) listener({ def, seed });
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
    cameraTarget = () => ORIGIN;
    cameraBounds = null;
    cameraRig.snap();
    freeLook = null;
    atmosphere.reset();

    const disposer = createDisposer();
    const loaded = { def, seed, disposer };
    current = loaded;
    (options.spawn ?? def.spawn)(world, rng);
    const ctx: SceneContext = {
      world,
      seed,
      scene,
      camera,
      input,
      meshOf: meshSync.meshOf,
      bindMesh: meshSync.bind,
      setCameraTarget: (target) => {
        cameraTarget = target;
      },
      setCameraBounds: (bounds) => {
        cameraBounds = bounds;
      },
      viewTime: () => (loop.tickCount - 1 + (settings.interpolate ? loop.alpha : 1)) / TICK_HZ,
      overlay: atmosphere.overlay,
      setShadowCasters: atmosphere.setShadowCasters,
      setLightTarget: atmosphere.setLightTarget,
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
  let pendingLoad: (LoadedScene & { options?: LoadOptions }) | null = null;
  const load = (def: SceneDef, seed: number, options?: LoadOptions) => {
    if (inFrame) pendingLoad = { def, seed, ...(options ? { options } : {}) };
    else doLoad(def, seed, options);
  };

  /** Opens or closes the pause menu (Esc): open, the game is paused; closed, it runs again. */
  const setMenu = (open: boolean) => {
    pauseMenu.value = { open, controls: input.preset.id };
    loop.paused = open;
    if (open) input.releaseAll();
    publishStats();
  };
  const setControls = (next: PresetId) => {
    if (next === input.preset.id) return;
    input.setPreset(next);
    savePreset(next);
    showNotice(`Controls: ${PRESETS[next].label}`);
    pauseMenu.value = { ...pauseMenu.value, controls: next };
  };
  menuActions.resume = () => setMenu(false);
  menuActions.setControls = (id) => {
    setControls(id);
    setMenu(false);
  };

  const frame = (frameSeconds: number) => {
    const frameStart = performance.now();
    phases = {};
    inFrame = true;

    fitCanvas(engine);
    // Focus events aren't reliable (closing a native dropdown list may not send `focus`), so an
    // auto-pause also lifts as soon as the page has focus again.
    if (loop.autoPaused && !document.hidden && document.hasFocus()) updateAutoPause();
    // Aim is recomputed every frame: the camera can move even when the mouse doesn't. It goes
    // through the rendering camera (the debug free camera, if on) so it's under the cursor; WASD
    // stays relative to the game camera. The game camera is still where the last frame rendered
    // it (it's placed after mesh sync, below), which is what the cursor points at.
    const pointer = dom.pointer;
    const aim = pointer && groundAim.project(pointer.x, pointer.y, scene.activeCamera ?? camera);
    if (aim) input.setAim(aim);
    // The body under the cursor on screen, for clicking enemies: only while the mouse is the
    // game's (not borrowed by a debug tool, not in the pause menu).
    const canHover = pointer && input.mouseButtons && !pauseMenu.value.open;
    input.setHover(
      canHover ? hoverPick.pick(pointer.x, pointer.y, scene.activeCamera ?? camera) : null,
    );
    yaw = cameraYaw(camera);

    const shellFrame = input.sampleFrame();
    if (shellFrame.pressed.has("pause")) setMenu(!pauseMenu.value.open);
    if (shellFrame.pressed.has("switchControls")) {
      setControls(input.preset.id === "mmo" ? "moba" : "mmo");
    }
    if (pauseMenu.value.controls !== input.preset.id) {
      pauseMenu.value = { ...pauseMenu.value, controls: input.preset.id };
    }
    // The menu needs the real pointer (the moba scheme locks it to the canvas).
    if (pauseMenu.value.open && dom.locked) document.exitPointerLock();
    dom.syncLock();
    const armed = !!world.with("player").first?.player?.attackMove?.armed;
    cursor.update(dom.locked ? dom.pointer : null, input.hover !== null || armed);
    for (const listener of frameListeners) listener(shellFrame);

    const { alpha } = loop.advance(frameSeconds);
    inFrame = false;
    if (pendingLoad) {
      const { def, seed, options } = pendingLoad;
      pendingLoad = null;
      doLoad(def, seed, options);
    }
    time("meshSync", () => meshSync.sync(settings.interpolate ? alpha : 1));
    // After mesh sync, so it follows an interpolated mesh without a frame of lag.
    placeCamera(frameSeconds, dom.pointer, shellFrame.held.has("centerCamera"));
    atmosphere.update(frameSeconds);
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

  /**
   * The look-ahead offset the camera eases toward: from the cursor's place on screen, zero (so the
   * view eases back to the player) when the cursor isn't the player's to use (outside the canvas,
   * page unfocused, a replay playing, the free camera rendering), or null to hold it (paused).
   */
  const lookAheadTarget = (pointer: { x: number; y: number } | null): Vec2 | null => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const usable =
      pointer !== null &&
      pointer.x >= 0 &&
      pointer.y >= 0 &&
      pointer.x <= width &&
      pointer.y <= height &&
      document.hasFocus() &&
      !driver &&
      scene.activeCamera === camera;
    if (!usable) return { x: 0, z: 0 };
    if (loop.paused) return null;
    return lookAheadOffset(pointer, width, height, yaw, {
      distance: CAMERA.lookAhead,
      deadZone: CAMERA.deadZone,
    });
  };

  /**
   * moba's free camera: it stays where it is, pans while the cursor is at a screen edge, and
   * `center` (Space) puts it back on the player (held: it keeps following). Starts on the player.
   */
  const freeCamera = (
    seconds: number,
    pointer: { x: number; y: number } | null,
    target: Vec2,
    center: boolean,
  ): Vec2 => {
    let look = !freeLook || center ? { x: target.x, z: target.z } : freeLook;
    const usable =
      pointer !== null &&
      document.hasFocus() &&
      scene.activeCamera === camera &&
      CAMERA.edgePanSpeed > 0;
    if (usable && !center) {
      const direction = edgePanDirection(
        pointer,
        canvas.clientWidth,
        canvas.clientHeight,
        yaw,
        CAMERA.edgePanSize,
      );
      const step = CAMERA.edgePanSpeed * seconds;
      look = { x: look.x + direction.x * step, z: look.z + direction.z * step };
    }
    if (cameraBounds && CAMERA.bounds) look = clampToRect(look, cameraBounds, CAMERA.boundsInset);
    freeLook = look;
    return look;
  };

  const placeCamera = (
    seconds: number,
    pointer: { x: number; y: number } | null,
    center: boolean,
  ) => {
    const target = cameraTarget();
    const free = input.preset.move.kind === "pointer";
    const offset = free ? null : lookAheadTarget(pointer);
    let lookAt: Vec2;
    if (free) {
      lookAt = freeCamera(seconds, pointer, target, center);
      // Back in WASD, the follow starts over from the player.
      cameraRig.snap();
    } else {
      freeLook = null;
      lookAt = cameraRig.update(
        {
          target,
          offset,
          bounds: CAMERA.bounds ? cameraBounds : null,
          follow: CAMERA.follow,
          lookAheadLag: CAMERA.lookAheadLag,
          inset: CAMERA.boundsInset,
        },
        seconds,
      );
    }
    updateCamera(camera, { x: lookAt.x, y: target.y, z: lookAt.z });

    const draw = { category: "camera" } as const;
    debugDraw.arrow(target, lookAt, { ...draw, color: "yellow" });
    debugDraw.point(lookAt, { ...draw, color: "yellow" });
    if (offset) {
      debugDraw.point(
        { x: target.x + offset.x, z: target.z + offset.z },
        { ...draw, color: "grey" },
      );
    }
    if (cameraBounds && CAMERA.bounds) {
      const { minX, maxX, minZ, maxZ } = cameraBounds;
      const inset = CAMERA.boundsInset;
      const lo = clampToRect({ x: minX, z: minZ }, cameraBounds, inset);
      const hi = clampToRect({ x: maxX, z: maxZ }, cameraBounds, inset);
      const corners = [lo, { x: hi.x, z: lo.z }, hi, { x: lo.x, z: hi.z }];
      debugDraw.path(corners, { ...draw, color: "cyan", closed: true });
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
    atmosphere,
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
    onBeforeLoad: (listener) => listen(beforeLoadListeners, listener),
    setTickDriver(next) {
      driver = next;
    },
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
