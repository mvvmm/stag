import { signal } from "@preact/signals";
import type { Vec2 } from "@/core/math";
import type { Action, AnyAction } from "@/input/actions";

export type LoopStats = {
  fps: number;
  /** Measured simulation ticks per second (game time, so it drops with slow-mo). */
  tickRate: number;
  /** Render interpolation factor between the previous and current tick. */
  alpha: number;
  paused: boolean;
  autoPaused: boolean;
  timeScale: number;
  interpolate: boolean;
};

export const loopStats = signal<LoopStats>({
  fps: 0,
  tickRate: 0,
  alpha: 0,
  paused: false,
  autoPaused: false,
  timeScale: 1,
  interpolate: true,
});

export type InputStats = {
  preset: string;
  /** Move vector the simulation saw on its latest tick. */
  move: Vec2;
  moveCommand: Vec2 | null;
  aim: Vec2;
  /** Actions held right now (live, including debug actions). */
  held: AnyAction[];
  /** How many ticks have seen each action pressed; one per physical press. */
  pressCounts: Partial<Record<Action, number>>;
  /** Actions pressed within the last moment, for highlighting. */
  flashing: Action[];
};

export const inputStats = signal<InputStats>({
  preset: "",
  move: { x: 0, z: 0 },
  moveCommand: null,
  aim: { x: 0, z: 0 },
  held: [],
  pressCounts: {},
  flashing: [],
});
