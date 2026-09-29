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
 * neighbours the weights cross-fade by speed (smoothstep), below the first one the idle fades in
 * under `idleBelow`, and above the last one it stays. The stride rate makes the blended stride
 * cover `speed` (speed / blended stride length), clamped to the blended clips' own rates.
 */
export function gaitBlend(speed: number, gaits: readonly Gait[], options: GaitOptions): GaitBlend {
  const weights = gaits.map(() => 0);
  const first = gaits[0];
  if (!first) return { idle: 1, weights, cyclesPerSecond: 0 };
  const v = Math.max(speed, 0);

  const idle = options.idleBelow > 0 ? 1 - smoothstep(v / options.idleBelow) : v > 0 ? 0 : 1;
  let index = 0;
  while (index < gaits.length - 1 && v >= (gaits[index + 1] as Gait).speed) index++;
  const lower = gaits[index] as Gait;
  const upper = gaits[index + 1];
  const t =
    upper && v > lower.speed ? smoothstep((v - lower.speed) / (upper.speed - lower.speed)) : 0;
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
