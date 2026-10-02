import { wrapAngle } from "@/core/math";

// The player body's animation logic (1.6), Babylon-free so it's unit-tested in Node: which gait
// clips play at a ground speed and how fast, and the springs that smooth the procedural layers
// (lean, tilt, tail, head). View-only: it runs on the time the view shows and never touches the
// simulation, so it may use Math.exp and friends.

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** A looping locomotion clip. */
export type Gait = {
  /** Ground speed at which the feet stick to the ground at 1× playback, m/s. */
  speed: number;
  /** Clip length, seconds (one full stride). */
  duration: number;
  /** The speed by which it has fully taken over from the gait below (m/s, at least that one's
   * speed); its own `speed` when left out. Lower than `speed`, it plays slowed down there. */
  from?: number;
};

export type GaitOptions = {
  /** Below this speed (m/s) the idle fades in, fully idle at 0. */
  idleBelow: number;
  /** Playback never goes faster than this multiple of a clip's own rate (feet slide past it). */
  maxRate: number;
  /** Nor slower than this multiple, so a barely moving body still steps instead of freezing. */
  minRate: number;
};

export type GaitBlend = {
  /** The idle's weight; the gaits' weights plus it sum to 1. */
  idle: number;
  /** One weight per gait, in the order given. */
  weights: number[];
  /** How fast the shared stride phase advances, cycles per second. */
  cyclesPerSecond: number;
};

const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * The clip weights and stride rate for a ground `speed`. `gaits` are sorted by speed; between two
 * neighbours the weights cross-fade by speed (smoothstep, the upper one fully in by its `from`
 * speed), below the first one the idle fades in
 * under `idleBelow`, and above the last one it stays. The stride rate makes the blended stride
 * cover `speed` (speed / blended stride length), clamped to the blended clips' own rates.
 */
export function gaitBlend(speed: number, gaits: readonly Gait[], options: GaitOptions): GaitBlend {
  const weights = gaits.map(() => 0);
  const first = gaits[0];
  if (!first) return { idle: 1, weights, cyclesPerSecond: 0 };
  const v = Math.max(speed, 0);

  const idle = options.idleBelow > 0 ? 1 - smoothstep(v / options.idleBelow) : v > 0 ? 0 : 1;
  // The gait is fully in from `full`: between one gait's and the next one's, they cross-fade.
  const full = (gait: Gait) => gait.from ?? gait.speed;
  let index = 0;
  while (index < gaits.length - 1 && v >= full(gaits[index + 1] as Gait)) index++;
  const lower = gaits[index] as Gait;
  const upper = gaits[index + 1];
  const t =
    upper && v > lower.speed
      ? smoothstep((v - lower.speed) / Math.max(full(upper) - lower.speed, 1e-6))
      : 0;
  weights[index] = (1 - t) * (1 - idle);
  if (upper) weights[index + 1] = t * (1 - idle);

  // Stride length and natural rate of the gaits in play, weighted.
  const moving = 1 - idle;
  const share = (i: number) => (moving > 0 ? (weights[i] as number) / moving : i === 0 ? 1 : 0);
  let stride = 0;
  let natural = 0;
  gaits.forEach((gait, i) => {
    stride += share(i) * gait.speed * gait.duration;
    natural += share(i) / gait.duration;
  });
  const rate = stride > 0 ? v / stride : 0;
  const cyclesPerSecond = clamp(rate, natural * options.minRate, natural * options.maxRate);
  return { idle, weights, cyclesPerSecond: moving > 0 ? cyclesPerSecond : 0 };
}

/** The time within a clip for a shared stride `phase` (cycles), shifted by the clip's `offset`. */
export function clipTime(phase: number, offset: number, duration: number): number {
  const cycle = phase + offset;
  return (cycle - Math.floor(cycle)) * duration;
}

/** A damped spring's state: where it is and how fast it's moving. */
export type Spring = { value: number; velocity: number };

/** The longest substep a spring integrates, seconds (keeps it stable and frame-rate independent). */
const SPRING_STEP = 1 / 240;

/**
 * Moves `spring` toward `target` for `dt` seconds: a damped harmonic oscillator with natural
 * `frequency` (Hz) and `damping` ratio (1 = critical, no overshoot; below 1 it swings), integrated
 * in small semi-implicit substeps so the result barely depends on the frame rate.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  frequency: number,
  damping: number,
  dt: number,
): void {
  if (dt <= 0) return;
  if (frequency <= 0) {
    spring.value = target;
    spring.velocity = 0;
    return;
  }
  const omega = 2 * Math.PI * frequency;
  const steps = Math.ceil(dt / SPRING_STEP);
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const accel = omega * omega * (target - spring.value) - 2 * damping * omega * spring.velocity;
    spring.velocity += accel * h;
    spring.value += spring.velocity * h;
  }
}

/** Puts `spring` at rest on `value` (after a teleport or a replay seek). */
export function snapSpring(spring: Spring, value = 0): void {
  spring.value = value;
  spring.velocity = 0;
}

/**
 * How far the body banks into a turn, radians: the lean that balances the centripetal
 * acceleration (speed × turn rate) against gravity, scaled by `amount` and clamped to ±`max`.
 * Positive leans toward positive turns.
 */
export function bankAngle(speed: number, turnRate: number, amount: number, max: number): number {
  return clamp(Math.atan2(speed * turnRate, 9.81) * amount, -max, max);
}

/**
 * The yaw (radians, body-relative, positive like the body's own yaw) for looking from a body at
 * `from` facing `facing` toward `to` on the ground, clamped to ±`max`; 0 when `to` is right on top.
 */
export function lookYaw(
  from: { x: number; z: number },
  facing: number,
  to: { x: number; z: number },
  max: number,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx * dx + dz * dz < 1e-6) return 0;
  // Same convention as the sim's facing: yaw 0 looks along +Z, positive turns toward +X.
  return clamp(wrapAngle(Math.atan2(dx, dz) - facing), -max, max);
}

/**
 * Steps a chain of springs (a tail): the first follows `drive`, and each one after it follows the
 * one before, so a swing travels down the chain and the tip lags behind like a whip. Each spring
 * has natural `frequency` (Hz) and `damping` ratio.
 */
export function stepChain(
  chain: Spring[],
  drive: number,
  frequency: number,
  damping: number,
  dt: number,
): void {
  let target = drive;
  for (const link of chain) {
    stepSpring(link, target, frequency, damping, dt);
    target = link.value;
  }
}

/**
 * A slow, irregular sway in [-1, 1] at time `t` (s): two sines at unrelated rates, so it never
 * looks like a metronome. `rate` is the main one's cycles per second.
 */
export function sway(t: number, rate: number): number {
  const TAU = 2 * Math.PI;
  return 0.7 * Math.sin(TAU * rate * t) + 0.3 * Math.sin(TAU * rate * 1.618 * t + 1.3);
}

// 1.7: starts, stops, short moves and the spine. The sim turns and stops near instantly (like
// League), so the body's motion comes from here.

/** How the gaits are being played. */
export type GaitMode = "idle" | "move" | "shuffle" | "stop";

/** The gait driver's state, carried from frame to frame. */
export type GaitDriver = {
  mode: GaitMode;
  /** The shared stride phase, cycles in [0, 1). */
  phase: number;
  /** The clip weights shown: the idle first, then one per gait. They follow the wanted ones. */
  weights: number[];
  /** While stopping: the gait weights kept to finish the step, how fast it strides, and how many
   * cycles are left until the planted point it stops on. */
  held: number[];
  heldRate: number;
  stopIn: number;
  /** The stride rate it last moved at, cycles per second. */
  rate: number;
  /** Set on the frame a move starts from standing (for the push-off). */
  started: boolean;
};

export type DriverOptions = GaitOptions & {
  /** The shared phase a move starts on from standing (the push-off foot). */
  startPhase: number;
  /** A short move's stride rate, as a multiple of the first gait's own (the walk). */
  shuffleRate: number;
  /** The longest a stop keeps striding to reach a planted point, s. */
  stopMax: number;
  /** How long the weights take to follow (cross-fades, the fade into the idle), s. */
  fade: number;
};

export function createGaitDriver(gaits: number): GaitDriver {
  return {
    mode: "idle",
    phase: 0,
    weights: [1, ...Array.from({ length: gaits }, () => 0)],
    held: Array.from({ length: gaits }, () => 0),
    heldRate: 0,
    stopIn: 0,
    rate: 0,
    started: false,
  };
}

/**
 * Advances the gaits for `dt` seconds at ground `speed`:
 * - moving, they blend by speed (`gaitBlend`), or a short move (`shuffle`) plays the first gait
 *   (the walk) at `shuffleRate` times its own rate, so it steps instead of flickering through
 *   the gallop. A move from standing starts on `startPhase`.
 * - when the speed drops to 0, the gaits keep striding, as they were, to the next planted point
 *   (`stopScore`: how far the pose at a shared phase is from standing, lowest is best; at most
 *   `stopMax` ahead), and only then fade into the idle. The legs land instead of sliding together.
 * The shown weights follow the wanted ones with a time constant of `fade`.
 */
export function stepGaits(
  driver: GaitDriver,
  speed: number,
  shuffle: boolean,
  gaits: readonly Gait[],
  options: DriverOptions,
  stopScore: (phase: number) => number,
  dt: number,
): void {
  driver.started = false;
  const walk = gaits[0];
  const rest = [1, ...gaits.map(() => 0)];
  let wanted = rest;
  let rate = 0;

  if (speed > 1e-3 && walk) {
    // From (nearly) standing, start on the push-off foot; mid-fade, carry on from where it is.
    if (driver.mode !== "move" && driver.mode !== "shuffle" && (driver.weights[0] ?? 0) > 0.95) {
      driver.phase = options.startPhase - Math.floor(options.startPhase);
      driver.started = true;
    }
    if (shuffle) {
      driver.mode = "shuffle";
      wanted = [0, 1, ...gaits.slice(1).map(() => 0)];
      rate = options.shuffleRate / walk.duration;
    } else {
      driver.mode = "move";
      const blend = gaitBlend(speed, gaits, options);
      wanted = [blend.idle, ...blend.weights];
      rate = blend.cyclesPerSecond;
    }
    driver.rate = rate;
  } else {
    if (driver.mode === "move" || driver.mode === "shuffle") {
      // Finish the step: keep the gaits as they were, striding on to the best point in reach.
      const shown = driver.weights.slice(1);
      const total = shown.reduce((sum, w) => sum + w, 0);
      driver.mode = "idle";
      if (total > 0.05) {
        driver.held = shown.map((w) => w / total);
        let natural = 0;
        gaits.forEach((gait, i) => {
          natural += (driver.held[i] ?? 0) / gait.duration;
        });
        driver.heldRate = Math.max(driver.rate, natural * options.minRate);
        driver.stopIn = nextStopPhase(driver.phase, driver.heldRate * options.stopMax, stopScore);
        driver.mode = "stop";
      }
    }
    if (driver.mode === "stop") {
      wanted = [0, ...driver.held];
      rate = Math.min(driver.heldRate, dt > 0 ? driver.stopIn / dt : 0);
      driver.stopIn -= rate * dt;
      if (driver.stopIn <= 1e-9) driver.mode = "idle";
    }
  }

  driver.phase = (driver.phase + rate * dt) % 1;
  const follow = options.fade > 0 ? 1 - Math.exp(-dt / options.fade) : 1;
  driver.weights = driver.weights.map((w, i) => w + ((wanted[i] ?? 0) - w) * follow);
}

/** Candidate stop points looked at per stride cycle. */
const STOP_SAMPLES = 48;

/**
 * How many cycles ahead of `phase` (at most `window`) the best point to stop on is: the lowest
 * `score` (how far the pose there is from standing), checked every 1/48 of a cycle. 0 when the
 * window is shorter than that.
 */
export function nextStopPhase(
  phase: number,
  window: number,
  score: (phase: number) => number,
): number {
  let best = 0;
  let bestScore = score(phase - Math.floor(phase));
  const steps = Math.floor(Math.max(window, 0) * STOP_SAMPLES);
  for (let i = 1; i <= steps; i++) {
    const ahead = i / STOP_SAMPLES;
    const at = phase + ahead;
    const value = score(at - Math.floor(at));
    if (value < bestScore - 1e-9) {
      best = ahead;
      bestScore = value;
    }
  }
  return best;
}

/** The push-off's shape over its `duration`: 0 at both ends, 1 at the middle, smooth. */
export function pushOffCurve(t: number, duration: number): number {
  if (duration <= 0 || t <= 0 || t >= duration) return 0;
  const s = Math.sin((Math.PI * t) / duration);
  return s * s;
}

/** The spine's bend: where the shoulders and the hips point, relative to the facing (radians). */
export type Bend = { front: Spring; hips: Spring };

export type BendOptions = {
  /** How fast the shoulders catch up with the facing (Hz) and their damping (below 1: a little
   * overshoot, the body's slack). */
  frontFrequency: number;
  frontDamping: number;
  /** How fast the hips follow the shoulders (Hz, critically damped). */
  hipFrequency: number;
  /** The most the hips trail the shoulders (radians). */
  max: number;
};

export function createBend(): Bend {
  return { front: { value: 0, velocity: 0 }, hips: { value: 0, velocity: 0 } };
}

/**
 * The facing turned by `turn` (radians) this frame: the shoulders and hips stay where they were
 * in the world and then spring back onto it, the shoulders quickly, the hips behind them, never
 * more than `max` behind. The body curves through a turn instead of spinning like a pole.
 */
export function stepBend(bend: Bend, turn: number, options: BendOptions, dt: number): void {
  bend.front.value -= turn;
  bend.hips.value -= turn;
  stepSpring(bend.front, 0, options.frontFrequency, options.frontDamping, dt);
  stepSpring(bend.hips, bend.front.value, options.hipFrequency, 1, dt);
  const trail = bend.hips.value - bend.front.value;
  if (Math.abs(trail) > options.max) {
    bend.hips.value = bend.front.value + Math.sign(trail) * options.max;
    bend.hips.velocity = bend.front.velocity;
  }
  // A reversal leaves the shoulders up to 180° behind: they never lag more than half a turn.
  const lag = Math.PI * 0.75;
  if (Math.abs(bend.front.value) > lag) {
    const shift = bend.front.value - Math.sign(bend.front.value) * lag;
    bend.front.value -= shift;
    bend.hips.value -= shift;
  }
}

/** Whether a move is still short enough to shuffle, carried from tick to tick. */
export type ShuffleGate = { time: number; committed: boolean };

/**
 * Per tick: a move shuffles until it's committed, which is when its right-click path is longer
 * than `distance` (m), or, without a path, it has wanted to move for longer than `time` (s).
 * Wanting nothing ends the move.
 */
export function stepShuffle(
  gate: ShuffleGate,
  wants: boolean,
  pathLength: number | null,
  options: { distance: number; time: number },
  dt: number,
): boolean {
  if (!wants) {
    gate.time = 0;
    gate.committed = false;
    return false;
  }
  gate.time += dt;
  if (pathLength !== null ? pathLength > options.distance : gate.time > options.time) {
    gate.committed = true;
  }
  return !gate.committed;
}
