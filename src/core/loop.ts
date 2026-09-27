/**
 * Fixed-timestep accumulator loop. Pure: it knows nothing about rendering or requestAnimationFrame.
 * The caller feeds it wall-clock frame deltas; it runs `update(dt)` zero or more times with a fixed
 * `dt` and returns `alpha` (how far we are between the previous and the current tick) for
 * render interpolation.
 */
export type FixedLoopOptions = {
  tickHz: number;
  /** Frame deltas longer than this (seconds) are clamped. */
  maxFrameDelta: number;
  /** Most ticks per `advance`; past that the leftover time is dropped. */
  maxTicksPerFrame: number;
  update: (dt: number) => void;
};

export type FixedLoop = {
  /** Paused by the player (or game). */
  paused: boolean;
  /** Paused because the tab is hidden or the window lost focus. Separate from `paused`. */
  autoPaused: boolean;
  /** Game-time multiplier (e.g. 0.25 for slow-mo). `dt` stays fixed; this changes how many ticks run. */
  timeScale: number;
  readonly dt: number;
  readonly running: boolean;
  /** Last interpolation factor in [0, 1). Frozen while paused. */
  readonly alpha: number;
  /** Total ticks run since creation. */
  readonly tickCount: number;
  advance(frameSeconds: number): { ticks: number; alpha: number };
};

export function createFixedLoop(options: FixedLoopOptions): FixedLoop {
  const dt = 1 / options.tickHz;
  let accumulator = 0;
  let tickCount = 0;
  // Set while suspended; the first frame after resuming spans the pause, so it's discarded.
  let suspended = false;

  const loop: FixedLoop = {
    paused: false,
    autoPaused: false,
    timeScale: 1,
    dt,
    get running() {
      return !loop.paused && !loop.autoPaused;
    },
    get alpha() {
      return accumulator / dt;
    },
    get tickCount() {
      return tickCount;
    },
    advance(frameSeconds) {
      if (!loop.running) {
        suspended = true;
        return { ticks: 0, alpha: loop.alpha };
      }
      let frame = Math.min(Math.max(frameSeconds, 0), options.maxFrameDelta);
      if (suspended) {
        suspended = false;
        frame = 0;
      }

      accumulator += frame * Math.max(loop.timeScale, 0);
      let ticks = 0;
      while (accumulator >= dt && ticks < options.maxTicksPerFrame) {
        options.update(dt);
        accumulator -= dt;
        ticks++;
      }
      if (accumulator >= dt) accumulator %= dt;
      tickCount += ticks;
      return { ticks, alpha: loop.alpha };
    },
  };
  return loop;
}
