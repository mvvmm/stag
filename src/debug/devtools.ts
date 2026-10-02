import { Color3, HighlightLayer, Mesh, MeshBuilder, SceneInstrumentation } from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import { formatChanges, tuning } from "@/core/tuning";
import { BUILD } from "@/debug/build";
import { defineCheats } from "@/debug/cheats";
import { createCommandRegistry } from "@/debug/commands";
import { createDebugDrawRenderer } from "@/debug/debugDrawRender";
import { createFrameStats } from "@/debug/frameStats";
import { createFreeCamera } from "@/debug/freeCamera";
import { defineGallopPresets } from "@/debug/gallopPresets";
import { attachInputOverlay } from "@/debug/inputOverlay";
import { getPath, type Path } from "@/debug/inspect";
import { createInspector } from "@/debug/inspector";
import { defineMovementPresets } from "@/debug/movementPresets";
import {
  type DebugSettings,
  loadDebugSettings,
  STATS_MODES,
  type StatsMode,
  saveDebugSettings,
} from "@/debug/persist";
import { createPicker } from "@/debug/picker";
import {
  acceptDroppedReplays,
  decodeReplay,
  downloadReplay,
  fetchFixture,
  pickReplayFile,
  saveFixture,
} from "@/debug/replay/files";
import { createReplaySession } from "@/debug/replay/session";
import { createStandIns } from "@/debug/standIns";
import { resolveStartup } from "@/debug/startup";
import type { Entity } from "@/ecs/world";
import { isEditable, savePreset } from "@/input/dom";
import { bodyView } from "@/render/bodyView";
import type { ReplayFile } from "@/replay/format";
import { scenes } from "@/scenes";
import type { SceneDef } from "@/scenes/scene";
import { randomSeed, type Shell } from "@/shell";
import { debugState, perfStats } from "@/ui/signals";

const TIME_SCALES = [1, 0.25, 0.05];
const PERF_INTERVAL = 0.25;
/** Shows and hides the debug pane. Not a game binding: the dev tools listen for it themselves. */
const PANE_TOGGLE = "Backquote";
const HOVER_COLOR = new Color3(0.95, 0.9, 0.7);
const SELECTED_COLOR = new Color3(1, 0.3, 0.9);
/** Frames the highlight layer renders its warm-up mesh once ready, and the most it waits. */
const WARMUP_FRAMES = 3;
const WARMUP_GIVE_UP = 300;

export type DevTools = ReturnType<typeof startDevtools>;

/**
 * Starts the dev tools (only loaded when `DEBUG`): the debug pane (always there, <kbd>`</kbd>
 * hides and shows it, or closes the Inspector while that's open), stats and profiler, debug draw, tunable persistence, the Inspector,
 * commands, scene switching/reset/frame step, the entity picker and record & replay (every load
 * is recorded; replays play back through the in-place reset). There are no dev keybinds:
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

  // Debug builds always record draws; each category is switched on in the pane's View folder.
  debugDraw.enabled = true;
  for (const [category, shown] of Object.entries(stored.draw.categories)) {
    debugDraw.setCategory(category, shown);
  }
  scene.forceWireframe = stored.wireframe;
  const atmosphere = shell.atmosphere.view;
  atmosphere.enabled = stored.atmosphere;
  atmosphere.valueView = stored.valueView;
  const standIns = createStandIns(shell);
  standIns.on = stored.standIns;
  bodyView.hitboxes = stored.hitboxes;

  // Record & replay. Created before `save` subscribes to tunables, so a replay's tunables are
  // already set aside when the settings are written.
  const replay = createReplaySession(shell, {
    commands,
    setPaused: (paused) => tools.setPaused(paused),
    changed: () => pane?.refresh(),
  });

  const save = () => {
    const settings: DebugSettings = {
      v: 1,
      paneFolders: state.paneFolders,
      stats: state.stats,
      draw: { categories: Object.fromEntries(debugDraw.categories) },
      wireframe: scene.forceWireframe,
      inputOverlay: state.inputOverlay,
      atmosphere: atmosphere.enabled,
      valueView: atmosphere.valueView,
      standIns: standIns.on,
      hitboxes: bodyView.hitboxes,
      // While a replay's tunables are in place, the player's own are what's remembered.
      tunables: replay.storedOverrides() ?? tuning.overrides(),
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

  // A thin outline around the entity under the cursor while picking (pale) and the selection
  // (magenta). Outer glow only, so the mesh itself stays readable.
  const highlight = new HighlightLayer("debugHighlight", scene, { isStroke: true });
  highlight.innerGlow = false;
  highlight.blurHorizontalSize = 0.6;
  highlight.blurVerticalSize = 0.6;
  const highlighted = new Map<Mesh, Color3>();

  // Warm-up: the layer imports its shaders and builds its effects, render targets and pipelines on
  // first use. Done on the first hover, that froze a frame and flashed the whole screen. So the
  // layer warms up right away on a speck of a mesh with nothing composed (outer glow off), and
  // real meshes join only once it's ready. With no meshes in it, the layer costs nothing.
  let warmup: Mesh | null = MeshBuilder.CreateBox("highlightWarmup", { size: 0.001 }, scene);
  warmup.isPickable = false;
  highlight.outerGlow = false;
  highlight.addMesh(warmup, HOVER_COLOR);
  let warmFrames = 0;
  let readyFrames = 0;
  const warmUp = (mesh: Mesh) => {
    const subMesh = mesh.subMeshes[0];
    const ready = !!subMesh && highlight.isLayerReady() && highlight.isReady(subMesh, false);
    if (ready) readyFrames++;
    // A few rendered frames once ready, so every pass has run; give up waiting after ~5 s.
    if (readyFrames > WARMUP_FRAMES || ++warmFrames > WARMUP_GIVE_UP) {
      highlight.removeMesh(mesh);
      mesh.dispose();
      highlight.outerGlow = true;
      warmup = null;
    }
  };

  shell.addRenderPhase("highlight", () => {
    if (warmup) {
      warmUp(warmup);
      return;
    }
    const want = new Map<Mesh, Color3>();
    // An entity's mesh may be an empty root with the model's meshes under it (the player).
    const outline = (entity: Entity | null, color: Color3) => {
      const mesh = entity && shell.meshOf(entity);
      if (!mesh) return;
      for (const part of [mesh, ...mesh.getChildMeshes(false)]) {
        if (part instanceof Mesh && part.getTotalVertices() > 0 && part.isEnabled()) {
          want.set(part, color);
        }
      }
    };
    outline(picker.hovered, HOVER_COLOR);
    outline(selected, SELECTED_COLOR);
    for (const [mesh, color] of highlighted) {
      if (want.get(mesh) !== color) {
        highlight.removeMesh(mesh);
        highlighted.delete(mesh);
      }
    }
    for (const [mesh, color] of want) {
      if (highlighted.has(mesh)) continue;
      highlight.addMesh(mesh, color);
      highlighted.set(mesh, color);
    }
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
      pane?.refresh();
    },
    /**
     * Edits a field of the selection. Transform edits snap, so the move doesn't smear. Edits are
     * sim input: they're recorded, and during a replay they take over first.
     */
    editField(path: Path, value: unknown) {
      if (!selected) return;
      // The pane writes values back unchanged now and then; only real changes are edits.
      if (Object.is(getPath(selected, path), value)) return;
      const index = shell.world.entities.indexOf(selected);
      if (index < 0) return;
      replay.edit({ entity: index, path: [...path], value });
    },

    replay,
    /** Downloads the current recording (or the replay being played). */
    async saveReplay(): Promise<string | null> {
      const file = replay.currentFile();
      if (!file) return null;
      const name = await downloadReplay(file);
      replay.setNotice(`saved ${name}`);
      return name;
    },
    /** Dev server only: writes the current recording into `src/replay/fixtures/` as a test. */
    async saveReplayAsTest(name?: string): Promise<string | null> {
      const file = replay.currentFile();
      if (!file) return null;
      const wanted = name ?? window.prompt("Replay test name (a-z, 0-9, -)", file.scene);
      if (!wanted) return null;
      try {
        const path = await saveFixture(file, wanted);
        if (path) replay.setNotice(`saved ${path}`);
        return path;
      } catch (error) {
        replay.setNotice(String(error instanceof Error ? error.message : error), "warn");
        return null;
      }
    },
    /** Plays a replay from a file object, raw bytes or a URL (e.g. from a fixture). */
    async playReplay(source: ReplayFile | Uint8Array | string): Promise<boolean> {
      try {
        const file =
          typeof source === "string"
            ? await decodeReplay(new Uint8Array(await (await fetch(source)).arrayBuffer()))
            : source instanceof Uint8Array
              ? await decodeReplay(source)
              : source;
        replay.play(file);
        return true;
      } catch (error) {
        replay.setNotice(`can't play: ${error instanceof Error ? error.message : error}`, "warn");
        return false;
      }
    },
    async loadReplay(): Promise<boolean> {
      const bytes = await pickReplayFile();
      return bytes ? tools.playReplay(bytes) : false;
    },
    async playFixture(name: string): Promise<boolean> {
      try {
        return await tools.playReplay(await fetchFixture(name));
      } catch (error) {
        replay.setNotice(String(error instanceof Error ? error.message : error), "warn");
        return false;
      }
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
    setCategory(category: string, shown: boolean) {
      debugDraw.setCategory(category, shown);
      save();
    },
    /** Off: flat grey-box lighting, no fog, shadows or post effects (A/B, collision/nav work). */
    setAtmosphere(on: boolean) {
      atmosphere.enabled = on;
      save();
      pane?.refresh();
    },
    setValueView(on: boolean) {
      atmosphere.valueView = on;
      save();
      pane?.refresh();
    },
    setStandIns(on: boolean) {
      standIns.on = on;
      save();
      pane?.refresh();
    },
    standIns,
    /** The grey-box capsule instead of the player's model (room scenes). */
    setHitboxes(on: boolean) {
      bodyView.hitboxes = on;
      save();
      pane?.refresh();
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
    ["inspector.toggle", "Babylon Inspector", () => void tools.toggleInspector()],
    ["wireframe.toggle", "Wireframe", () => tools.setWireframe(!scene.forceWireframe)],
    ["atmosphere.toggle", "Atmosphere", () => tools.setAtmosphere(!atmosphere.enabled)],
    ["valueView.toggle", "Value view", () => tools.setValueView(!atmosphere.valueView)],
    ["standIns.toggle", "Stand-in threats", () => tools.setStandIns(!standIns.on)],
    ["hitboxes.toggle", "Hitboxes instead of models", () => tools.setHitboxes(!bodyView.hitboxes)],
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
    ["replay.save", "Save replay", () => void tools.saveReplay()],
    ["replay.stop", "Stop recording", () => replay.stop()],
    ["replay.new", "New recording from here", () => void replay.newRecording()],
    ["replay.takeOver", "Take over the replay", () => replay.takeOver()],
    ["replay.exit", "Exit the replay", () => replay.exit()],
  ];
  for (const [id, label, run] of builtIns) {
    commands.define({ id, label, group: "Built-in", button: false, run });
  }
  defineMovementPresets(commands);
  defineGallopPresets(commands);
  defineCheats(commands, shell);

  // --- Pane toggle (`), outside the game's input ----------------------------------------------

  window.addEventListener("keydown", (event) => {
    if (event.code !== PANE_TOGGLE || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    event.preventDefault();
    // The pane steps aside while the Inspector is open, so ` closes the Inspector first.
    if (inspector.open) void tools.toggleInspector();
    else tools.setPaneVisible(!state.paneVisible);
  });

  acceptDroppedReplays((bytes) => void tools.playReplay(bytes));

  const drawRenderer = createDebugDrawRenderer(debugDraw, scene, shell.atmosphere.overlay, engine);
  shell.addRenderPhase("debugDraw", drawRenderer.update);
  attachInputOverlay(shell);

  // --- Console / agent handle ------------------------------------------------------------------

  window.__game = {
    build: BUILD,
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
    replay: {
      recording: () => replay.currentFile(),
      play: tools.playReplay,
      seek: replay.seek,
      stepBack: replay.stepBack,
      takeOver: replay.takeOver,
      exit: replay.exit,
      stop: replay.stop,
      newRecording: replay.newRecording,
      save: tools.saveReplay,
      get status() {
        return {
          mode: replay.mode,
          tick: replay.tick,
          ticks: replay.ticks,
          diverged: replay.divergence,
          seeking: replay.seeking,
          notice: replay.notice,
        };
      },
    },
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
