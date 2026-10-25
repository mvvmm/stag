import type { Action } from "@/input/actions";

/**
 * A physical control: a `KeyboardEvent.code` (`KeyW`, `Digit1`, `Space`) or a mouse button as
 * `Mouse<button>` (`Mouse0` = left, `Mouse2` = right). Physical codes keep the layout the same
 * on AZERTY and other keyboard layouts. `Shift+<control>` and `Alt+<control>` are chords: pressed
 * with either Shift (or Alt) held, the control triggers the chord's actions instead of its own,
 * when that chord is bound. With both held, the `Alt+` chord wins, then the `Shift+` one, then the
 * plain control.
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
    // The auto attack: click an enemy (hold to attack whatever's under the cursor while moving).
    primary: ["Mouse0"],
    ability1: ["Digit1"],
    ability2: ["Digit2"],
    ability3: ["Digit3"],
    ultimate: ["Digit4"],
    // Left click is the auto attack, so interact is on F.
    interact: ["KeyF"],
    pause: ["Escape"],
  },
};

/** moba: the slot keys, each with a Shift chord (normal cast) and an Alt chord (self cast). */
export const MOBA_SLOT_KEYS = {
  ability1: "KeyQ",
  ability2: "KeyW",
  ability3: "KeyE",
  ultimate: "KeyR",
  extra1: "KeyD",
  extra2: "KeyF",
} as const satisfies Partial<Record<Action, Control>>;

/** A slot key on its own (quick cast) and with Shift (normal cast) or Alt (self cast). */
const slotControls = (key: Control): Control[] => [key, `Shift+${key}`, `Alt+${key}`];
const slotChords = (modifier: "Shift" | "Alt"): Control[] =>
  Object.values(MOBA_SLOT_KEYS).map((key) => `${modifier}+${key}`);

export const MOBA_PRESET: Preset = {
  id: "moba",
  label: "MOBA (right-click)",
  move: { kind: "pointer", control: "Mouse2" },
  actions: {
    // Same button as moving: on an enemy it's an attack order, on the ground a move order.
    primary: ["Mouse2"],
    // The slot keys quick cast; with Shift they also press `normalCast` (aim first, a left click
    // casts), with Alt `selfCast`. No dodge: mobility comes from abilities. D and F (League's
    // summoner spells) are two extra slots outside the loadout.
    ability1: slotControls(MOBA_SLOT_KEYS.ability1),
    ability2: slotControls(MOBA_SLOT_KEYS.ability2),
    ability3: slotControls(MOBA_SLOT_KEYS.ability3),
    ultimate: slotControls(MOBA_SLOT_KEYS.ultimate),
    extra1: slotControls(MOBA_SLOT_KEYS.extra1),
    extra2: slotControls(MOBA_SLOT_KEYS.extra2),
    normalCast: slotChords("Shift"),
    selfCast: slotChords("Alt"),
    interact: ["Mouse0"],
    // A stops and S attack-moves (League's S and A, swapped: the way we like it). Shift +
    // right-click attack-moves at once (arms and places it in one press).
    stop: ["KeyA"],
    attackMove: ["KeyS", "Shift+Mouse2"],
    confirm: ["Mouse0", "Shift+Mouse2"],
    pause: ["Escape"],
    // Space centers the camera, like League.
    centerCamera: ["Space"],
  },
};

export const PRESETS: Record<PresetId, Preset> = { mmo: MMO_PRESET, moba: MOBA_PRESET };
/** Right-click is the only player-facing scheme since 2.2 (WASD stays for the debug pane). */
export const DEFAULT_PRESET: PresetId = "moba";

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && value in PRESETS;
}

const MOUSE_LABELS: Record<string, string> = { Mouse0: "LMB", Mouse1: "MMB", Mouse2: "RMB" };

/** A control as a player reads it: `KeyQ` → `Q`, `Digit1` → `1`, `Mouse2` → `RMB`,
 * `Shift+Mouse2` → `Shift+RMB`. */
export function controlLabel(control: Control): string {
  const plus = control.lastIndexOf("+");
  if (plus > 0) return `${control.slice(0, plus + 1)}${controlLabel(control.slice(plus + 1))}`;
  if (control in MOUSE_LABELS) return MOUSE_LABELS[control] as string;
  if (control.startsWith("Key")) return control.slice(3);
  if (control.startsWith("Digit")) return control.slice(5);
  return control;
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
