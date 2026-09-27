import type { BindingApi, BladeApi, FolderApi } from "@tweakpane/core";
import { Pane } from "tweakpane";
import { debugDraw } from "@/core/debugDraw";
import { type Tunable, tuning } from "@/core/tuning";
import type { DevTools } from "@/debug/devtools";
import { createEntityPane } from "@/debug/entityPane";
import { entityLabel } from "@/debug/inspect";
import { STATS_MODES } from "@/debug/persist";
import { parseSeed } from "@/debug/startup";
import type { Entity } from "@/ecs/world";

const REFRESH_INTERVAL = 250;
/** The entity dropdown lists at most this many entities; picking reaches the rest. */
const MAX_LISTED = 200;
const NONE = -1;

/**
 * The debug pane (Tweakpane, loaded lazily), the one place every dev tool is controlled from:
 * scene switching, seed and restart, loop and view controls with frame step, the entity picker
 * (the selection's components get their own pane, see `entityPane.ts`), debug-draw categories, tunables with changed markers, resets
 * and "copy changes", and a button for every command that asks for one. Always there in debug builds;
 * <kbd>`</kbd> hides and shows it. It's a debug view, so it reads and writes the tools directly
 * instead of going through UI signals.
 */
export function createPane(tools: DevTools) {
  const { shell, state } = tools;
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;top:16px;right:16px;width:300px;max-height:calc(100vh - 32px);" +
    "overflow-y:auto;pointer-events:auto;z-index:10";
  document.body.append(container);
  const pane = new Pane({ container, title: "Debug", expanded: state.paneFolders.Debug ?? true });
  pane.on("fold", (event) => {
    state.paneFolders.Debug = event.expanded;
    tools.save();
  });
  let visible = true;

  /** A folder whose expanded state is remembered by its title path. */
  const folder = (parent: FolderApi, title: string, path = title, expanded = false) => {
    const result = parent.addFolder({ title, expanded: state.paneFolders[path] ?? expanded });
    result.on("fold", (event) => {
      state.paneFolders[path] = event.expanded;
      tools.save();
    });
    return result;
  };

  // --- Loop ------------------------------------------------------------------------------------

  const view = {
    get paused() {
      return shell.loop.paused;
    },
    set paused(v: boolean) {
      tools.setPaused(v);
    },
    get timeScale() {
      return shell.loop.timeScale;
    },
    set timeScale(v: number) {
      tools.setTimeScale(v);
    },
    get interpolate() {
      return shell.settings.interpolate;
    },
    set interpolate(v: boolean) {
      tools.setInterpolate(v);
    },
    get preset() {
      return shell.input.preset.id;
    },
    set preset(v: "mmo" | "moba") {
      tools.setPreset(v);
    },
    get stats() {
      return state.stats;
    },
    set stats(v: (typeof STATS_MODES)[number]) {
      tools.setStats(v);
    },
    get inputOverlay() {
      return state.inputOverlay;
    },
    set inputOverlay(v: boolean) {
      tools.setInputOverlay(v);
    },
    get wireframe() {
      return shell.scene.forceWireframe;
    },
    set wireframe(v: boolean) {
      tools.setWireframe(v);
    },
    get freeCamera() {
      return tools.freeCamera.active;
    },
    set freeCamera(v: boolean) {
      tools.setFreeCamera(v);
    },
    get draw() {
      return debugDraw.enabled;
    },
    set draw(v: boolean) {
      tools.setDraw(v);
    },
  };

  // --- Scene -----------------------------------------------------------------------------------

  const sceneView = {
    get scene() {
      return shell.current?.def.id ?? "";
    },
    set scene(id: string) {
      if (id !== shell.current?.def.id) tools.loadScene(id);
    },
    get seed() {
      return String(shell.current?.seed ?? "");
    },
    /** Enter (or leaving the field) restarts with the typed seed; anything else reverts. */
    set seed(text: string) {
      const seed = parseSeed(text);
      if (seed !== null) tools.restart(seed);
      else queueMicrotask(() => pane.refresh());
    },
  };
  const sceneFolder = folder(pane, "Scene", "Scene", true);
  sceneFolder.addBinding(sceneView, "scene", {
    options: Object.fromEntries(tools.scenes.list().map((def) => [def.label, def.id])),
  });
  const seedBinding = sceneFolder.addBinding(sceneView, "seed");
  const seedLabel = seedBinding.element.querySelector(".tp-lblv_l");
  if (seedLabel instanceof HTMLElement) seedLabel.title = "Type a seed and press Enter to restart";
  sceneFolder.addButton({ title: "Restart (same seed)" }).on("click", () => tools.restart());
  sceneFolder.addButton({ title: "New seed" }).on("click", () => tools.newSeed());

  // --- Loop ------------------------------------------------------------------------------------

  const loopFolder = folder(pane, "Loop", "Loop", true);
  loopFolder.addBinding(view, "paused");
  loopFolder.addButton({ title: "Step one tick" }).on("click", () => tools.step());
  loopFolder.addBinding(
    {
      get tick() {
        return shell.loop.tickCount;
      },
    },
    "tick",
    { readonly: true, format: (v: number) => v.toFixed(0) },
  );
  loopFolder.addBinding(view, "timeScale", { label: "time scale", min: 0.05, max: 2, step: 0.05 });
  loopFolder.addBinding(view, "interpolate");
  loopFolder.addBinding(view, "preset", { options: { "MMO (WASD)": "mmo", "MOBA (RMB)": "moba" } });

  const viewFolder = folder(pane, "View", "View", true);
  viewFolder.addBinding(view, "stats", {
    options: Object.fromEntries(STATS_MODES.map((mode) => [mode, mode])),
  });
  viewFolder.addBinding(view, "inputOverlay", { label: "input overlay" });
  viewFolder.addBinding(view, "wireframe");
  const freeCameraBinding = viewFolder.addBinding(view, "freeCamera", { label: "free camera" });
  const freeCameraLabel = freeCameraBinding.element.querySelector(".tp-lblv_l");
  if (freeCameraLabel instanceof HTMLElement) {
    freeCameraLabel.title =
      "Drag to orbit, right-drag to pan, wheel to zoom (mouse buttons skip the game)";
  }
  viewFolder
    .addButton({
      title: tools.inspector.available ? "Babylon Inspector" : "Inspector (pnpm dev only)",
      disabled: !tools.inspector.available,
    })
    .on("click", () => void tools.toggleInspector());

  // --- Entity ----------------------------------------------------------------------------------

  const entityFolder = folder(pane, "Entity", "Entity", true);
  entityFolder.addBinding(
    {
      get pick() {
        return tools.picker.active;
      },
      set pick(on: boolean) {
        tools.setPick(on);
      },
    },
    "pick",
    { label: "pick in world" },
  );
  const pickLabel = entityFolder.element.querySelector(".tp-lblv_l");
  if (pickLabel instanceof HTMLElement) {
    pickLabel.title = "Click an entity to select it; the game gets no mouse buttons meanwhile";
  }

  const selectionView = {
    get selected() {
      const entity = tools.selected;
      return (entity && shell.world.id(entity)) ?? NONE;
    },
    set selected(id: number) {
      tools.select(id === NONE ? null : id);
    },
  };
  let listBinding: BladeApi | null = null;
  let listKey = "";
  /** Rebuilds the dropdown when the listed entities (or their components) change. */
  const syncEntityList = () => {
    const world = shell.world;
    // Ids are handed out on first use; asking in world order keeps them in spawn order.
    for (const entity of world.entities) world.id(entity);
    const listed: [string, number][] = [["(none)", NONE]];
    const add = (entity: Entity) => {
      const id = world.id(entity);
      if (id !== undefined) listed.push([entityLabel(id, entity), id]);
    };
    world.entities.slice(0, MAX_LISTED).forEach(add);
    const selected = tools.selected;
    if (selected && world.entities.indexOf(selected) >= MAX_LISTED) add(selected);
    const hidden = world.entities.length - MAX_LISTED;
    const key = `${hidden}|${listed.map(([label]) => label).join("|")}`;
    if (key === listKey) return;
    listKey = key;
    const index = listBinding ? entityFolder.children.indexOf(listBinding) : 1;
    listBinding?.dispose();
    const options = Object.fromEntries(listed);
    listBinding = entityFolder.addBinding(selectionView, "selected", {
      label: hidden > 0 ? `selected (${MAX_LISTED} of ${world.entities.length})` : "selected",
      options,
      index,
    });
  };
  const entityPane = createEntityPane(tools);

  const syncEntity = () => {
    syncEntityList();
    entityPane.sync(visible && !tools.inspector.open);
  };

  // --- Debug draw ------------------------------------------------------------------------------

  const drawFolder = folder(pane, "Debug draw", "Debug draw", true);
  drawFolder.addBinding(view, "draw", { label: "enabled" });
  const categoryViews = new Map<string, { shown: boolean }>();
  /** Adds toggles for categories that appeared since the last check (systems draw lazily). */
  const syncCategories = () => {
    for (const [category, shown] of debugDraw.categories) {
      if (categoryViews.has(category)) continue;
      const categoryView = { shown };
      categoryViews.set(category, categoryView);
      drawFolder
        .addBinding(categoryView, "shown", { label: category })
        .on("change", (event) => tools.setCategory(category, event.value));
    }
    for (const [category, categoryView] of categoryViews) {
      categoryView.shown = debugDraw.categories.get(category) ?? true;
    }
  };

  // --- Tunables --------------------------------------------------------------------------------

  const tunablesFolder = folder(pane, "Tunables", "Tunables", true);
  tunablesFolder.addButton({ title: "Copy changes" }).on("click", () => {
    void tools.copyTunableChanges();
  });
  tunablesFolder.addButton({ title: "Reset all" }).on("click", () => tuning.reset());

  let groupFolders: FolderApi[] = [];
  const bindings = new Map<string, { api: BindingApi; tunable: Tunable }>();
  const markChanged = () => {
    for (const { api, tunable } of bindings.values()) {
      const changed = tuning.get(tunable.id) !== tunable.default;
      api.label = changed ? `● ${tunable.key}` : tunable.key;
    }
  };

  /** (Re)builds the tunable folders, e.g. after a module redefined its group. */
  const buildTunables = () => {
    for (const groupFolder of groupFolders) groupFolder.dispose();
    groupFolders = [];
    bindings.clear();

    const groups = new Map<string, Tunable[]>();
    for (const tunable of tuning.list()) {
      groups.set(tunable.group, [...(groups.get(tunable.group) ?? []), tunable]);
    }
    for (const [group, tunables] of groups) {
      const groupFolder = folder(tunablesFolder, group, `Tunables/${group}`, true);
      groupFolders.push(groupFolder);
      // Bind to a proxy so every edit goes through the registry (validation, listeners, storage).
      const proxy: Record<string, unknown> = {};
      for (const tunable of tunables) {
        Object.defineProperty(proxy, tunable.key, {
          get: () => tuning.get(tunable.id),
          set: (value) => tuning.set(tunable.id, value),
          enumerable: true,
        });
        const spec = tunable.spec;
        const params =
          "options" in spec
            ? { options: Object.fromEntries(spec.options.map((option) => [option, option])) }
            : typeof spec.value === "number"
              ? {
                  min: "min" in spec ? spec.min : undefined,
                  max: "max" in spec ? spec.max : undefined,
                  step: "step" in spec ? spec.step : undefined,
                }
              : {};
        const api = groupFolder.addBinding(proxy, tunable.key, params);
        // Double-click a label to reset that one value.
        const label = api.element.querySelector(".tp-lblv_l");
        if (label instanceof HTMLElement) {
          label.title = `${tunable.id} (default ${String(tunable.default)}) · double-click to reset`;
          label.style.cursor = "pointer";
          label.addEventListener("dblclick", () => tuning.reset(tunable.id));
        }
        bindings.set(tunable.id, { api, tunable });
      }
      groupFolder.addButton({ title: `Reset ${group}` }).on("click", () => tuning.reset(group));
    }
    markChanged();
  };
  buildTunables();

  const offTuning = tuning.onChange((id) => {
    if (id === null) buildTunables();
    else {
      markChanged();
      pane.refresh();
    }
  });

  // --- Commands --------------------------------------------------------------------------------

  // Only commands without a dedicated control get buttons (cheats, later); hidden while none do.
  let commandsFolder: FolderApi | null = null;
  const buildCommands = () => {
    commandsFolder?.dispose();
    commandsFolder = null;
    const buttons = tools.commands.buttons();
    if (!buttons.length) return;
    commandsFolder = folder(pane, "Commands", "Commands", true);
    const groups = new Map<string, FolderApi>();
    for (const command of buttons) {
      let groupFolder = groups.get(command.group);
      if (!groupFolder) {
        groupFolder = folder(commandsFolder, command.group, `Commands/${command.group}`, true);
        groups.set(command.group, groupFolder);
      }
      groupFolder.addButton({ title: command.label }).on("click", command.run);
    }
  };
  buildCommands();
  const offCommands = tools.commands.onChange(buildCommands);

  // Step aside while the Babylon Inspector is open: it docks panels on both sides of the page.
  const updateDisplay = () => {
    container.style.display = visible && !tools.inspector.open ? "" : "none";
  };

  // Keep live values (pause, categories, …) in sync with changes made from code or the console.
  const timer = window.setInterval(() => {
    updateDisplay();
    syncCategories();
    syncEntity();
    pane.refresh();
  }, REFRESH_INTERVAL);
  syncCategories();
  syncEntity();

  return {
    refresh(): void {
      updateDisplay();
      syncCategories();
      syncEntity();
      pane.refresh();
    },
    setVisible(show: boolean): void {
      visible = show;
      updateDisplay();
      syncEntity();
    },
    dispose(): void {
      window.clearInterval(timer);
      entityPane.dispose();
      offTuning();
      offCommands();
      pane.dispose();
      container.remove();
    },
  };
}
