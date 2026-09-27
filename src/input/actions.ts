import type { Vec2 } from "@/core/math";

/** Game actions the simulation sees, named by role rather than by key. */
export const ACTIONS = [
  "primary",
  "ability1",
  "ability2",
  "ability3",
  "ultimate",
  "dodge",
  "interact",
  "stop",
  "pause",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Dev/demo actions handled by the shell outside the simulation. Revisited in 0.4. */
export const DEBUG_ACTIONS = ["toggleInterpolation", "cycleTimeScale", "switchPreset"] as const;
export type DebugAction = (typeof DEBUG_ACTIONS)[number];

export type AnyAction = Action | DebugAction;

/** Everything the simulation knows about input for one fixed tick. */
export type InputFrame = {
  /** World ground-plane direction, length ≤ 1. Zero when idle or in the moba scheme. */
  move: Vec2;
  /** moba: cursor ground point while the move button went down or is held this tick; else null. */
  moveCommand: Vec2 | null;
  /** Cursor on the ground plane. */
  aim: Vec2;
  held: ReadonlySet<Action>;
  /** Went down since the previous tick (reported to exactly one tick). */
  pressed: ReadonlySet<Action>;
  /** Went up since the previous tick (reported to exactly one tick). */
  released: ReadonlySet<Action>;
};

/** Per-frame input for the shell: works while the simulation is paused. */
export type ShellFrame = {
  held: ReadonlySet<AnyAction>;
  pressed: ReadonlySet<AnyAction>;
};

export function emptyInputFrame(): InputFrame {
  return {
    move: { x: 0, z: 0 },
    moveCommand: null,
    aim: { x: 0, z: 0 },
    held: new Set(),
    pressed: new Set(),
    released: new Set(),
  };
}
