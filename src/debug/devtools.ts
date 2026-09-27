import { SceneInstrumentation } from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import { formatChanges, tuning } from "@/core/tuning";
import { createCommandRegistry } from "@/debug/commands";
import { createDebugDrawRenderer } from "@/debug/debugDrawRender";
import { createFrameStats } from "@/debug/frameStats";
import { createFreeCamera } from "@/debug/freeCamera";
import { createInspector } from "@/debug/inspector";
import {
  type DebugSettings,
  loadDebugSettings,
  STATS_MODES,
  type StatsMode,
  saveDebugSettings,
} from "@/debug/persist";
import { isEditable, savePreset } from "@/input/dom";
import type { Shell } from "@/shell";
import { debugState, perfStats } from "@/ui/signals";

const TIME_SCALES = [1, 0.25, 0.05];
const PERF_INTERVAL = 0.25;
/** Shows and hides the debug pane. Not a game binding: the dev tools listen for it themselves. */
const PANE_TOGGLE = "Backquote";

export type DevTools = ReturnType<typeof startDevtools>;

/**
 * Starts the dev tools (only loaded when `DEBUG`): the debug pane (always there, <kbd>`</kbd>
 * hides and shows it), stats and profiler, debug draw, tunable persistence, the Inspector and
 * commands. There are no dev keybinds: the keyboard always belongs to the game. Call before
 * `shell.start()` so stored tweaks apply before the first tick.
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
      input.setMouseButtons(!on);
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
    world: shell.world,
    loop,
    rng: shell.rng,
    scene,
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
