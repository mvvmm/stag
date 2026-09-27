import { signal } from "@preact/signals";

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
