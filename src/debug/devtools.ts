import { SceneInstrumentation } from "@babylonjs/core";
import { GROUND_Y } from "@/core/constants";
import { debugDraw } from "@/core/debugDraw";
import { formatChanges, tuning } from "@/core/tuning";
import { createCommandRegistry } from "@/debug/commands";
import { createDebugDrawRenderer } from "@/debug/debugDrawRender";
import { createFrameStats } from "@/debug/frameStats";
import { createFreeCamera } from "@/debug/freeCamera";
import { type Path, setPath } from "@/debug/inspect";
import { createInspector } from "@/debug/inspector";
import {
  type DebugSettings,
  loadDebugSettings,
  STATS_MODES,
  type StatsMode,
  saveDebugSettings,
} from "@/debug/persist";
import { createPicker } from "@/debug/picker";
import { resolveStartup } from "@/debug/startup";
import { type Entity, snapTransform } from "@/ecs/world";
import { isEditable, savePreset } from "@/input/dom";
import { scenes } from "@/scenes";
import type { SceneDef } from "@/scenes/scene";
import { randomSeed, type Shell } from "@/shell";
import { debugState, perfStats } from "@/ui/signals";

const TIME_SCALES = [1, 0.25, 0.05];
const PERF_INTERVAL = 0.25;
/** Shows and hides the debug pane. Not a game binding: the dev tools listen for it themselves. */
const PANE_TOGGLE = "Backquote";

export type DevTools = ReturnType<typeof startDevtools>;

/**
 * Starts the dev tools (only loaded when `DEBUG`): the debug pane (always there, <kbd>`</kbd>
 * hides and shows it), stats and profiler, debug draw, tunable persistence, the Inspector,
 * commands, scene switching/reset/frame step and the entity picker. There are no dev keybinds:
 * the keyboard always belongs to the game. Call before the first `shell.load()` and
 * `shell.start()`, so stored tweaks apply before the first tick; `startup()` says which scene and
 * seed to load.
 */
export function startDevtools(shell: Shell) {
  const { loop, input, scene, engine, settings: loopSettings } = shell;
  const canvas = engine.getRenderingCanvas() as HTMLCanvasElement;
  const stored = loadDebugSettings();
  const commands = createCommandRegistry();
  const inspector = createInspector(scene);
  const freeCamera = createFreeCamera(scene, shell.gameCamera, canvas);
  const frameStats = createFrameStats();

  // --- State and persistence -------------------------------------------------------------------

  const state = {
    /** Hidden with <kbd>`</kbd>; not remembered, so every load starts with the pane showing. */
    paneVisible: true,
    paneFolders: { ...stored.paneFolders },
    stats: stored.stats,
    inputOverlay: stored.inputOverlay,
    /** The last scene loaded; reloads return to it. */
    scene: stored.scene,
  };

  const dropped = tuning.apply(stored.tunables);
  if (dropped.length) console.info(`dropped stale tunable tweaks: ${dropped.join(", ")}`);

  debugDraw.enabled = stored.draw.enabled;
  for (const [category, shown] of Object.entries(stored.draw.categories)) {
    debugDraw.setCategory(category, shown);
  }
  scene.forceWireframe = stored.wireframe;

  const save = () => {
    const settings: DebugSettings = {
      v: 1,
      paneFolders: state.paneFolders,
      stats: state.stats,
      draw: { enabled: debugDraw.enabled, categories: Object.fromEntries(debugDraw.categories) },
      wireframe: scene.forceWireframe,
      inputOverlay: state.inputOverlay,
      tunables: tuning.overrides(),
      scene: state.scene,
    };
    saveDebugSettings(settings);
  };
  tuning.onChange(save);

  const publish = () => {
    debugState.value = {
      active: true,
      stats: state.stats,
      inputOverlay: state.inputOverlay,
      inspector: inspector.open,
    };
    pane?.refresh();
  };

  // --- Stats instrumentation (only while full stats are shown) -------------------------------

  // GPU time comes from per-pass timestamp queries on the main (canvas) pass; Babylon's
  // frame-level counter relies on encoder.writeTimestamp, which browsers no longer expose. Passes
  // into render targets (shadows, post-processing) will need their own counters later.
  let instruments: SceneInstrumentation | null = null;
  const syncInstruments = () => {
    const want = state.stats === "full";
    engine.enableGPUTimingMeasurements = want;
    if (want && !instruments) {
      instruments = new SceneInstrumentation(scene);
    } else if (!want && instruments) {
      instruments.dispose();
      instruments = null;
    }
  };

  let perfTimer = 0;
  shell.onFrameEnd((sample) => {
    frameStats.push(sample);
    perfTimer += sample.frameMs / 1000;
    if (perfTimer < PERF_INTERVAL || state.stats !== "full" || !instruments) return;
    perfTimer = 0;
    const gpuNs = engine.gpuTimeInFrameForMainPass?.counter.lastSecAverage ?? 0;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    perfStats.value = {
      graph: [...frameStats.graph()],
      cpu: frameStats.cpu(),
      gpuMs: gpuNs > 0 ? gpuNs / 1e6 : null,
      drawCalls: instruments.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length,
      totalMeshes: scene.meshes.length,
      entities: shell.world.entities.length,
      heapMb: memory ? memory.usedJSHeapSize / 1024 / 1024 : null,
      profile: [...frameStats.profile()],
    };
  });

  // --- Selection -------------------------------------------------------------------------------

  let selected: Entity | null = null;
  const picker = createPicker(shell, (entity) => tools.select(entity));

  // Each load brings a fresh world: forget the selection and follow removals in the new world.
  let offRemoved: (() => void) | null = null;
  shell.onLoad(({ def }) => {
    selected = null;
    offRemoved?.();
    offRemoved = shell.world.onEntityRemoved.subscribe((entity) => {
      if (entity === selected) tools.select(null);
    });
    state.scene = def.id;
    save();
    pane?.refresh();
  });

  // A ring and `#id` around the selection, at its mesh (interpolated) or else its transform.
  shell.addRenderPhase("selection", () => {
    if (!selected) return;
    const at = shell.meshOf(selected)?.position ?? selected.transform?.position;
    if (!at) return;
    const options = { category: "selection", color: "magenta" } as const;
    debugDraw.circle({ x: at.x, z: at.z, y: GROUND_Y + 0.04 }, 0.9, options);
    debugDraw.text({ x: at.x, z: at.z, y: at.y + 1.2 }, `#${shell.world.id(selected)}`, options);
  });

  // --- Actions (what the pane's controls and the commands call) --------------------------------

  let pane: { refresh(): void; setVisible(visible: boolean): void } | null = null;

  const tools = {
    shell,
    commands,
    inspector,
    freeCamera,
    state,
    save,
    publish,
    timeScales: TIME_SCALES,
    picker,
    scenes,

    /** Which scene and seed to start: `?scene=`/`?seed=`, else the last scene with `freshSeed`. */
    startup(freshSeed: number): { def: SceneDef; seed: number } {
      const params = new URLSearchParams(location.search);
      const wanted = resolveStartup(params, stored.scene, freshSeed);
      if (wanted.invalidSeed !== null) {
        console.warn(`?seed=${wanted.invalidSeed} isn't a uint32; using ${wanted.seed}`);
      }
      const { scene, unknown } = scenes.resolve(wanted.sceneId);
      if (unknown) console.warn(`unknown scene "${wanted.sceneId}"; starting "${scene.id}"`);
      return { def: scene, seed: wanted.seed };
    },
    /** Loads a scene by id with the given seed (a fresh one by default). False if there's none. */
    loadScene(id: string, seed = randomSeed()): boolean {
      const def = scenes.get(id);
      if (!def) return false;
      shell.load(def, seed);
      return true;
    },
    /** Restarts the current scene with the same seed, or the given one. */
    restart(seed?: number) {
      shell.restart(seed);
    },
    newSeed() {
      shell.restart(randomSeed());
    },
    /** One tick. Pauses first if the game is running, so the step is visible. */
    step() {
      if (!loop.paused) tools.setPaused(true);
      shell.step();
      pane?.refresh();
    },

    get selected(): Entity | null {
      return selected;
    },
    /** Selects an entity (or its id in the current world); null or an unknown id deselects. */
    select(target: Entity | number | null) {
      const world = shell.world;
      const entity = typeof target === "number" ? world.entity(target) : target;
      selected = entity && world.has(entity) ? entity : null;
      // The highlight is debug draw, so selecting something turns it on.
      if (selected && !debugDraw.enabled) tools.setDraw(true);
      pane?.refresh();
    },
    /** Edits a field of the selection. Transform edits snap, so the move doesn't smear. */
    editField(path: Path, value: unknown) {
      if (!selected || !setPath(selected, path, value)) return;
      if (path[0] === "transform") snapTransform(selected);
    },
    /** Picking borrows the mouse: canvas clicks select entities instead of reaching the game. */
    setPick(on: boolean) {
      picker.active = on;
      pane?.refresh();
    },

    setPaneVisible(visible: boolean) {
      state.paneVisible = visible;
      pane?.setVisible(visible);
    },
    setStats(mode: StatsMode) {
      state.stats = mode;
      syncInstruments();
      save();
      publish();
    },
    setInputOverlay(on: boolean) {
      state.inputOverlay = on;
      save();
      publish();
    },
    setDraw(on: boolean) {
      debugDraw.enabled = on;
      save();
      pane?.refresh();
    },
    setCategory(category: string, shown: boolean) {
      debugDraw.setCategory(category, shown);
      save();
    },
    setWireframe(on: boolean) {
      scene.forceWireframe = on;
      save();
      pane?.refresh();
    },
    /** The free camera takes over the mouse, so the game gets no mouse buttons meanwhile. */
    setFreeCamera(on: boolean) {
      freeCamera.active = on;
      input.borrowMouse("freeCamera", on);
      pane?.refresh();
    },
    async toggleInspector() {
      const toggled = inspector.toggle();
      publish();
      await toggled;
      publish();
    },
    setPaused(paused: boolean) {
      loop.paused = paused;
      shell.publishStats();
      pane?.refresh();
    },
    setTimeScale(scale: number) {
      loop.timeScale = scale;
      shell.publishStats();
      pane?.refresh();
    },
    setInterpolate(on: boolean) {
      loopSettings.interpolate = on;
      shell.publishStats();
      pane?.refresh();
    },
    setPreset(id: "mmo" | "moba") {
      input.setPreset(id);
      savePreset(id);
      pane?.refresh();
    },
    async copyTunableChanges(): Promise<string> {
      const text = formatChanges(tuning.changes());
      try {
        await navigator.clipboard.writeText(text || "(no tunable changes)");
      } catch (error) {
        console.warn("clipboard unavailable", error);
      }
      console.info(text || "no tunable changes");
      return text;
    },
  };

  // --- Commands --------------------------------------------------------------------------------
  // The built-ins mirror pane controls (so they get no buttons) and exist for `__game.run(id)`.

  const cycle = <T>(list: readonly T[], current: T): T =>
    list[(list.indexOf(current) + 1) % list.length] as T;

  const builtIns: [id: string, label: string, run: () => void][] = [
    ["pane.toggle", "Show / hide the pane", () => tools.setPaneVisible(!state.paneVisible)],
    [
      "stats.cycle",
      "Stats: off / compact / full",
      () => tools.setStats(cycle(STATS_MODES, state.stats)),
    ],
    ["input.overlay", "Input overlay", () => tools.setInputOverlay(!state.inputOverlay)],
    ["draw.toggle", "Debug draw", () => tools.setDraw(!debugDraw.enabled)],
    ["inspector.toggle", "Babylon Inspector", () => void tools.toggleInspector()],
    ["wireframe.toggle", "Wireframe", () => tools.setWireframe(!scene.forceWireframe)],
    ["freeCamera.toggle", "Free camera", () => tools.setFreeCamera(!freeCamera.active)],
    ["loop.pause", "Pause / resume", () => tools.setPaused(!loop.paused)],
    [
      "loop.timeScale",
      "Cycle time scale",
      () => tools.setTimeScale(cycle(TIME_SCALES, loop.timeScale)),
    ],
    ["loop.interpolate", "Interpolation", () => tools.setInterpolate(!loopSettings.interpolate)],
    [
      "input.preset",
      "Switch input preset",
      () => tools.setPreset(input.preset.id === "mmo" ? "moba" : "mmo"),
    ],
    ["tuning.copy", "Copy tunable changes", () => void tools.copyTunableChanges()],
    ["tuning.reset", "Reset all tunables", () => tuning.reset()],
    ["loop.step", "Step one tick", () => tools.step()],
    ["scene.restart", "Restart (same seed)", () => tools.restart()],
    ["scene.newSeed", "Restart with a new seed", () => tools.newSeed()],
    ["pick.toggle", "Pick entities", () => tools.setPick(!picker.active)],
  ];
  for (const [id, label, run] of builtIns) {
    commands.define({ id, label, group: "Built-in", button: false, run });
  }

  // --- Pane toggle (`), outside the game's input ----------------------------------------------

  window.addEventListener("keydown", (event) => {
    if (event.code !== PANE_TOGGLE || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    event.preventDefault();
    tools.setPaneVisible(!state.paneVisible);
  });

  const drawRenderer = createDebugDrawRenderer(debugDraw, scene, engine);
  shell.addRenderPhase("debugDraw", drawRenderer.update);

  // --- Console / agent handle ------------------------------------------------------------------

  window.__game = {
    get world() {
      return shell.world;
    },
    loop,
    get rng() {
      return shell.rng;
    },
    scene,
    scenes: {
      list: () => scenes.list().map((def) => def.id),
      current: () => shell.current && { id: shell.current.def.id, seed: shell.current.seed },
      load: tools.loadScene,
      restart: tools.restart,
    },
    get seed() {
      return shell.current?.seed ?? null;
    },
    get selected() {
      return selected;
    },
    select: tools.select,
    input,
    tunables: {
      list: tuning.list,
      get: tuning.get,
      set: tuning.set,
      reset: tuning.reset,
      changes: tuning.changes,
    },
    debugDraw,
    commands,
    run: commands.run,
    tools,
  };

  syncInstruments();
  publish();
  // The pane is a lazy chunk (Tweakpane); it's always part of the debug UI once loaded.
  void import("@/debug/pane").then(({ createPane }) => {
    pane = createPane(tools);
    pane.setVisible(state.paneVisible);
  });
  return tools;
}
