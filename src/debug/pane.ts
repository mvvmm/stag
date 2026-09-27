import type { BindingApi, FolderApi } from "@tweakpane/core";
import { Pane } from "tweakpane";
import { debugDraw } from "@/core/debugDraw";
import { type Tunable, tuning } from "@/core/tuning";
import { keyLabel } from "@/debug/commands";
import type { DevTools } from "@/debug/devtools";
import { STATS_MODES } from "@/debug/persist";

const REFRESH_INTERVAL = 250;

/**
 * The debug pane (Tweakpane, loaded lazily): tunables with changed markers, resets and "copy
 * changes"; loop and view controls; debug-draw categories; and a button for every command. It's a
 * debug view, so it reads and writes the tools directly instead of going through UI signals.
 */
export function createPane(tools: DevTools) {
  const { shell, state } = tools;
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;top:16px;right:16px;width:300px;max-height:calc(100vh - 32px);" +
    "overflow-y:auto;pointer-events:auto;z-index:10";
  document.body.append(container);
  const pane = new Pane({ container, title: "Debug" });

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

  const loopFolder = folder(pane, "Loop", "Loop", true);
  loopFolder.addBinding(view, "paused");
  loopFolder.addBinding(view, "timeScale", { label: "time scale", min: 0.05, max: 2, step: 0.05 });
  loopFolder.addBinding(view, "interpolate");
  loopFolder.addBinding(view, "preset", { options: { "MMO (WASD)": "mmo", "MOBA (RMB)": "moba" } });

  const viewFolder = folder(pane, "View");
  viewFolder.addBinding(view, "stats", {
    options: Object.fromEntries(STATS_MODES.map((mode) => [mode, mode])),
  });
  viewFolder.addBinding(view, "wireframe");
  viewFolder.addBinding(view, "freeCamera", { label: "free camera" });
  viewFolder
    .addButton({ title: "Toggle Inspector" })
    .on("click", () => tools.commands.run("inspector.toggle"));

  // --- Debug draw ------------------------------------------------------------------------------

  const drawFolder = folder(pane, "Debug draw");
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

  const commandsFolder = folder(pane, "Commands");
  const commandGroups = new Map<string, FolderApi>();
  for (const command of tools.commands.list()) {
    let groupFolder = commandGroups.get(command.group);
    if (!groupFolder) {
      groupFolder = folder(commandsFolder, command.group, `Commands/${command.group}`, true);
      commandGroups.set(command.group, groupFolder);
    }
    const title = command.key ? `${command.label}  [${keyLabel(command.key)}]` : command.label;
    groupFolder.addButton({ title }).on("click", command.run);
  }

  // Keep live values (pause, categories, …) in sync with changes made by keys or code. Step aside
  // while the Babylon Inspector is open: it docks panels on both sides of the page.
  const timer = window.setInterval(() => {
    container.style.display = tools.inspector.open ? "none" : "";
    syncCategories();
    pane.refresh();
  }, REFRESH_INTERVAL);
  syncCategories();

  return {
    refresh(): void {
      syncCategories();
      pane.refresh();
    },
    dispose(): void {
      window.clearInterval(timer);
      offTuning();
      pane.dispose();
      container.remove();
    },
  };
}
