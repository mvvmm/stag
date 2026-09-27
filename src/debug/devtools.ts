import { SceneInstrumentation } from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import { formatChanges, tuning } from "@/core/tuning";
import { createCommandRegistry, keyLabel } from "@/debug/commands";
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
import { savePreset } from "@/input/dom";
import type { Shell } from "@/shell";
import { debugState, perfStats } from "@/ui/signals";

const TIME_SCALES = [1, 0.25, 0.05];
const PERF_INTERVAL = 0.25;

export type DevTools = ReturnType<typeof startDevtools>;

/**
 * Starts the dev tools (only loaded when `DEBUG`): dev-keys mode, commands, stats and profiler,
 * debug draw, tunable persistence, and the lazily loaded pane and Inspector. Call before
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
    paneOpen: stored.paneOpen,
    paneFolders: { ...stored.paneFolders },
    stats: stored.stats,
    help: false,
  };

  const dropped = tuning.apply(stored.tunables);
  if (dropped.length) console.info(`dropped stale tunable tweaks: ${dropped.join(", ")}`);

  debugDraw.enabled = stored.draw.enabled;
  for (const [category, shown] of Object.entries(stored.draw.categories)) {
    debugDraw.setCategory(category, shown);
  }
  scene.forceWireframe = stored.wireframe;
  input.setDevMode(stored.devMode);

  const save = () => {
    const settings: DebugSettings = {
      v: 1,
      devMode: input.devMode,
      paneOpen: state.paneOpen,
      paneFolders: state.paneFolders,
      stats: state.stats,
      draw: { enabled: debugDraw.enabled, categories: Object.fromEntries(debugDraw.categories) },
      wireframe: scene.forceWireframe,
      tunables: tuning.overrides(),
    };
    saveDebugSettings(settings);
  };
  tuning.onChange(save);

  const publish = () => {
    debugState.value = {
      active: true,
      devMode: input.devMode,
      stats: state.stats,
      help: state.help,
      inspector: inspector.open,
      keys: commands
        .list()
        .filter((command) => command.key)
        .map(({ group, key, label }) => ({ group, key: keyLabel(key as string), label })),
    };
    pane?.refresh();
  };
  commands.onChange(publish);

  // --- Pane (lazy) -----------------------------------------------------------------------------

  let pane: { refresh(): void; dispose(): void } | null = null;
  let paneLoading = false;
  const syncPane = async () => {
    if (state.paneOpen && !pane && !paneLoading) {
      paneLoading = true;
      try {
        const { createPane } = await import("@/debug/pane");
        if (state.paneOpen) pane = createPane(tools);
      } finally {
        paneLoading = false;
      }
    } else if (!state.paneOpen && pane) {
      pane.dispose();
      pane = null;
    }
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

  // --- Actions ----------------------------------------------------------------------------------

  const tools = {
    shell,
    commands,
    inspector,
    freeCamera,
    state,
    save,
    publish,
    timeScales: TIME_SCALES,

    setDevMode(on: boolean) {
      input.setDevMode(on);
      // The free camera only exists in dev mode, so the game is always seen from its own camera.
      if (!on) freeCamera.active = false;
      if (!on) state.help = false;
      save();
      publish();
    },
    setPaneOpen(open: boolean) {
      state.paneOpen = open;
      save();
      void syncPane();
    },
    setStats(mode: StatsMode) {
      state.stats = mode;
      syncInstruments();
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
    setFreeCamera(on: boolean) {
      if (on && !input.devMode) return;
      freeCamera.active = on;
      pane?.refresh();
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

  const cycle = <T>(list: readonly T[], current: T): T =>
    list[(list.indexOf(current) + 1) % list.length] as T;

  const define = commands.define;
  define({
    id: "help",
    label: "Dev-key cheat sheet",
    group: "Tools",
    key: "KeyH",
    run: () => {
      state.help = !state.help;
      publish();
    },
  });
  define({
    id: "pane.toggle",
    label: "Debug pane",
    group: "Tools",
    key: "KeyP",
    run: () => tools.setPaneOpen(!state.paneOpen),
  });
  define({
    id: "stats.cycle",
    label: "Stats (off/compact/full)",
    group: "Tools",
    key: "KeyS",
    run: () => tools.setStats(cycle(STATS_MODES, state.stats)),
  });
  define({
    id: "draw.toggle",
    label: "Debug draw",
    group: "Tools",
    key: "KeyG",
    run: () => tools.setDraw(!debugDraw.enabled),
  });
  define({
    id: "inspector.toggle",
    label: "Babylon Inspector",
    group: "Tools",
    key: "KeyI",
    run: () => {
      void inspector.toggle().then(publish);
      publish();
    },
  });
  define({
    id: "wireframe.toggle",
    label: "Wireframe",
    group: "View",
    key: "KeyW",
    run: () => tools.setWireframe(!scene.forceWireframe),
  });
  define({
    id: "freeCamera.toggle",
    label: "Free camera",
    group: "View",
    key: "KeyC",
    run: () => tools.setFreeCamera(!freeCamera.active),
  });
  define({
    id: "loop.pause",
    label: "Pause / resume",
    group: "Loop",
    key: "Space",
    run: () => tools.setPaused(!loop.paused),
  });
  define({
    id: "loop.timeScale",
    label: `Time scale (${TIME_SCALES.map((s) => `×${s}`).join(" ")})`,
    group: "Loop",
    key: "KeyT",
    run: () => tools.setTimeScale(cycle(TIME_SCALES, loop.timeScale)),
  });
  define({
    id: "loop.interpolate",
    label: "Interpolation",
    group: "Loop",
    key: "KeyL",
    run: () => tools.setInterpolate(!loopSettings.interpolate),
  });
  define({
    id: "input.preset",
    label: "Switch input preset",
    group: "Loop",
    key: "KeyB",
    run: () => tools.setPreset(input.preset.id === "mmo" ? "moba" : "mmo"),
  });
  define({
    id: "tuning.copy",
    label: "Copy tunable changes",
    group: "Tuning",
    run: () => void tools.copyTunableChanges(),
  });
  define({
    id: "tuning.reset",
    label: "Reset all tunables",
    group: "Tuning",
    run: () => tuning.reset(),
  });

  // --- Per frame -------------------------------------------------------------------------------

  shell.onFrame((frame) => {
    if (frame.devToggle) tools.setDevMode(!input.devMode);
    for (const control of frame.devPressed) commands.byKey(control)?.run();
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
  void syncPane();
  publish();
  return tools;
}
