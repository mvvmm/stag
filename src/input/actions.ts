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
  // Shell actions (read through `sampleFrame`, never by the simulation):
  /** Swap the control scheme (WASD ↔ right-click), until 1.7 picks one. */
  "switchControls",
  /** moba: snap the camera back onto the player (held: keep following). */
  "centerCamera",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Everything the simulation knows about input for one fixed tick. */
export type InputFrame = {
  /** World ground-plane direction, length ≤ 1. Zero when idle or in the moba scheme. */
  move: Vec2;
  /** moba: cursor ground point while the move button went down or is held this tick; else null. */
  moveCommand: Vec2 | null;
  /** Cursor on the ground plane. */
  aim: Vec2;
  /** The `uid` of the body under the cursor on screen (picked by the view, so a tall enemy counts
   * anywhere on its body), or null. The simulation decides whether it can be attacked. */
  hover: number | null;
  held: ReadonlySet<Action>;
  /** Went down since the previous tick (reported to exactly one tick). */
  pressed: ReadonlySet<Action>;
  /** Went up since the previous tick (reported to exactly one tick). */
  released: ReadonlySet<Action>;
};

/** Per-frame input for the shell: works while the simulation is paused. */
export type ShellFrame = {
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>;
};

export function emptyInputFrame(): InputFrame {
  return {
    move: { x: 0, z: 0 },
    moveCommand: null,
    aim: { x: 0, z: 0 },
    hover: null,
    held: new Set(),
    pressed: new Set(),
    released: new Set(),
  };
}
