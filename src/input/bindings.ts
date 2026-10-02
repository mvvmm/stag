import type { Action } from "@/input/actions";

/**
 * A physical control: a `KeyboardEvent.code` (`KeyW`, `Digit1`, `Space`) or a mouse button as
 * `Mouse<button>` (`Mouse0` = left, `Mouse2` = right). Physical codes keep the layout the same
 * on AZERTY and other keyboard layouts.
 */
export type Control = string;

export type MoveBinding =
  /** Direct control: a direction vector from held keys. */
  | {
      kind: "keys";
      up: readonly Control[];
      down: readonly Control[];
      left: readonly Control[];
      right: readonly Control[];
    }
  /** Click to move: the cursor's ground point while this control is down. */
  | { kind: "pointer"; control: Control };

export type PresetId = "mmo" | "moba";

export type Preset = {
  id: PresetId;
  label: string;
  move: MoveBinding;
  actions: Partial<Record<Action, readonly Control[]>>;
};

export const MMO_PRESET: Preset = {
  id: "mmo",
  label: "MMO (WASD)",
  move: {
    kind: "keys",
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
  },
  actions: {
    primary: ["Mouse2"],
    ability1: ["Digit1"],
    ability2: ["Digit2"],
    ability3: ["Digit3"],
    ultimate: ["Digit4"],
    dodge: ["Space"],
    interact: ["Mouse0"],
    pause: ["Escape"],
    switchControls: ["KeyM"],
  },
};

export const MOBA_PRESET: Preset = {
  id: "moba",
  label: "MOBA (right-click)",
  move: { kind: "pointer", control: "Mouse2" },
  actions: {
    // Same button as moving: the simulation decides between attack and move (later steps).
    primary: ["Mouse2"],
    ability1: ["KeyQ"],
    ability2: ["KeyW"],
    ability3: ["KeyE"],
    ultimate: ["KeyR"],
    // Space centers the camera, like League; dodge takes League's Flash key until 2.2 decides.
    dodge: ["KeyF"],
    interact: ["Mouse0"],
    stop: ["KeyS"],
    pause: ["Escape"],
    switchControls: ["KeyM"],
    centerCamera: ["Space"],
  },
};

export const PRESETS: Record<PresetId, Preset> = { mmo: MMO_PRESET, moba: MOBA_PRESET };
export const DEFAULT_PRESET: PresetId = "mmo";

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && value in PRESETS;
}

/** Control → actions it triggers in a preset. */
export function actionsByControl(preset: Preset): Map<Control, Action[]> {
  const map = new Map<Control, Action[]>();
  const add = (action: Action, controls: readonly Control[] | undefined) => {
    for (const control of controls ?? []) {
      const list = map.get(control);
      if (list) list.push(action);
      else map.set(control, [action]);
    }
  };
  for (const [action, controls] of Object.entries(preset.actions)) add(action as Action, controls);
  return map;
}
