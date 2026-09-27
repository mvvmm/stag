import type { BladeApi, FolderApi } from "@tweakpane/core";
import { Pane } from "tweakpane";
import type { DevTools } from "@/debug/devtools";
import {
  entityLabel,
  type Field,
  formatValue,
  getPath,
  inspectEntity,
  shapeKey,
} from "@/debug/inspect";
import type { Entity } from "@/ecs/world";

/** Main pane width + gap: this pane docks just left of it. */
const RIGHT = 16 + 300 + 16;

/**
 * A second Tweakpane panel for the selected entity, docked left of the main pane and only there
 * while something is selected: its components live (one folder each, nested objects as
 * subfolders), editable where they're plain numbers, booleans or strings. Rebuilt when the
 * selection or the shape of its data changes; the main pane drives `sync` on its refresh.
 */
export function createEntityPane(tools: DevTools) {
  const { shell, state } = tools;
  const container = document.createElement("div");
  container.style.cssText =
    `position:absolute;top:16px;right:${RIGHT}px;width:280px;max-height:calc(100vh - 32px);` +
    "overflow-y:auto;pointer-events:auto;z-index:10;display:none";
  document.body.append(container);
  const pane = new Pane({ container, title: "Entity" });

  let blades: BladeApi[] = [];
  let shownEntity: Entity | null = null;
  let shownKey = "";

  /** A folder whose expanded state is remembered by its component path. */
  const folder = (parent: FolderApi, title: string, path: string) => {
    const result = parent.addFolder({ title, expanded: state.paneFolders[path] ?? true });
    result.on("fold", (event) => {
      state.paneFolders[path] = event.expanded;
      tools.save();
    });
    return result;
  };

  const addFields = (parent: FolderApi, entity: Entity, fields: readonly Field[]) => {
    for (const field of fields) {
      const path = field.path;
      if (field.kind === "object") {
        const sub = folder(parent, field.key, `Entity/${path.join("/")}`);
        addFields(sub, entity, field.children);
        if (parent === pane) blades.push(sub);
        continue;
      }
      const readonly = field.kind === "readonly";
      // Bind to a proxy: edits go through the tools (transform edits snap), and reads are live.
      const proxy = {
        get value() {
          const value = getPath(entity, path);
          return readonly ? formatValue(value) : value;
        },
        set value(value: unknown) {
          tools.editField(path, value);
        },
      };
      const binding = parent.addBinding(proxy, "value", {
        label: field.key,
        ...(readonly ? { readonly: true } : {}),
        ...(field.kind === "number" ? { format: (v: number) => v.toFixed(3) } : {}),
      });
      if (parent === pane) blades.push(binding);
    }
  };

  pane.addButton({ title: "Deselect" }).on("click", () => tools.select(null));

  return {
    /** Shows the current selection (or hides the pane when there's none). */
    sync(visible: boolean): void {
      const entity = tools.selected;
      container.style.display = visible && entity ? "" : "none";
      const fields = entity ? inspectEntity(entity) : [];
      const key = shapeKey(fields);
      if (entity !== shownEntity || key !== shownKey) {
        shownEntity = entity;
        shownKey = key;
        for (const blade of blades) blade.dispose();
        blades = [];
        if (entity) addFields(pane, entity, fields);
      }
      if (entity) {
        const id = shell.world.id(entity);
        pane.title = id === undefined ? "Entity" : `Entity ${entityLabel(id, entity)}`;
        pane.refresh();
      }
    },
    dispose(): void {
      pane.dispose();
      container.remove();
    },
  };
}
