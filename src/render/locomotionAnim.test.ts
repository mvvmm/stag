import { describe, expect, it } from "vitest";
import {
  bankAngle,
  clipTime,
  contactPhase,
  createBend,
  createGaitDriver,
  type DriverOptions,
  flicks,
  type Gait,
  gaitBlend,
  lookYaw,
  nextStopPhase,
  noise,
  pairShift,
  pushOffCurve,
  type Spring,
  type StrideFeet,
  sampleLoop,
  snapSpring,
  stepBend,
  stepChain,
  stepGaits,
  stepShuffle,
  stepSpring,
  strideMotion,
} from "@/render/locomotionAnim";

const GAITS: Gait[] = [
  { speed: 0.3, duration: 1.6 },
  { speed: 1, duration: 0.75 },
  { speed: 2.5, duration: 0.5 },
];
const OPTIONS = { idleBelow: 0.2, maxRate: 2, minRate: 0.3 };
const sum = (blend: ReturnType<typeof gaitBlend>) =>
  blend.idle + blend.weights.reduce((a, b) => a + b, 0);

describe("gaitBlend", () => {
  it("is all idle at rest, not stepping", () => {
    const blend = gaitBlend(0, GAITS, OPTIONS);
    expect(blend.idle).toBe(1);
    expect(blend.weights).toEqual([0, 0, 0]);
    expect(blend.cyclesPerSecond).toBe(0);
  });

  it("weights always sum to 1", () => {
    for (let speed = 0; speed <= 8; speed += 0.05) {
      expect(sum(gaitBlend(speed, GAITS, OPTIONS))).toBeCloseTo(1, 9);
    }
  });

  it("plays each gait alone at its own speed, at its own rate", () => {
    GAITS.forEach((gait, i) => {
      const blend = gaitBlend(gait.speed, GAITS, OPTIONS);
      expect(blend.weights[i]).toBeCloseTo(1, 9);
      expect(blend.cyclesPerSecond).toBeCloseTo(1 / gait.duration, 9);
    });
  });

  it("cross-fades between neighbours only", () => {
    const blend = gaitBlend(0.65, GAITS, OPTIONS);
    expect(blend.weights[0]).toBeGreaterThan(0);
    expect(blend.weights[1]).toBeGreaterThan(0);
    expect(blend.weights[2]).toBe(0);
  });

  it("keeps the fastest gait past its speed, with the rate capped", () => {
    const blend = gaitBlend(20, GAITS, OPTIONS);
    expect(blend.weights[2]).toBe(1);
    expect(blend.cyclesPerSecond).toBeCloseTo(OPTIONS.maxRate / 0.5, 9);
  });

  it("speeds up the stride with speed, without jumps", () => {
    let last = 0;
    for (let speed = 0.01; speed <= 8; speed += 0.01) {
      const rate = gaitBlend(speed, GAITS, OPTIONS).cyclesPerSecond;
      expect(rate).toBeGreaterThanOrEqual(last - 1e-9);
      expect(rate - last).toBeLessThan(0.2);
      last = rate;
    }
  });
});

describe("clipTime", () => {
  it("wraps the shifted phase into the clip", () => {
    expect(clipTime(0, 0, 2)).toBe(0);
    expect(clipTime(0.25, 0.5, 2)).toBeCloseTo(1.5);
    expect(clipTime(3.75, 0.5, 2)).toBeCloseTo(0.5);
    expect(clipTime(-0.25, 0, 2)).toBeCloseTo(1.5);
  });
});

describe("stepSpring", () => {
  const settle = (fps: number, seconds: number, damping: number) => {
    const spring: Spring = { value: 0, velocity: 0 };
    const trace: number[] = [];
    for (let i = 0; i < fps * seconds; i++) {
      stepSpring(spring, 1, 3, damping, 1 / fps);
      trace.push(spring.value);
    }
    return { spring, trace };
  };

  it("settles on the target", () => {
    const { spring } = settle(60, 3, 1);
    expect(spring.value).toBeCloseTo(1, 4);
    expect(spring.velocity).toBeCloseTo(0, 3);
  });

  it("doesn't overshoot when critically damped, and swings when underdamped", () => {
    expect(Math.max(...settle(60, 2, 1).trace)).toBeLessThanOrEqual(1 + 1e-6);
    expect(Math.max(...settle(60, 2, 0.3).trace)).toBeGreaterThan(1.2);
  });

  it("barely depends on the frame rate", () => {
    const at = (fps: number) => {
      const spring: Spring = { value: 0, velocity: 0 };
      for (let i = 0; i < fps * 0.2; i++) stepSpring(spring, 1, 3, 0.5, 1 / fps);
      return spring.value;
    };
    expect(at(30)).toBeCloseTo(at(144), 2);
    expect(at(60)).toBeCloseTo(at(144), 2);
  });

  it("holds still for no time, and snaps", () => {
    const spring: Spring = { value: 0.5, velocity: 2 };
    stepSpring(spring, 1, 3, 1, 0);
    expect(spring).toEqual({ value: 0.5, velocity: 2 });
    snapSpring(spring, 0.2);
    expect(spring).toEqual({ value: 0.2, velocity: 0 });
  });
});

describe("bankAngle", () => {
  it("leans into the turn, more when faster, within the limit", () => {
    expect(bankAngle(0, 3, 1, 0.5)).toBe(0);
    expect(bankAngle(2, 1, 1, 0.5)).toBeGreaterThan(0);
    expect(bankAngle(2, -1, 1, 0.5)).toBeLessThan(0);
    expect(bankAngle(4, 1, 1, 0.5)).toBeGreaterThan(bankAngle(2, 1, 1, 0.5));
    expect(bankAngle(50, 10, 1, 0.5)).toBe(0.5);
  });
});

describe("lookYaw", () => {
  const from = { x: 0, z: 0 };
  it("is 0 straight ahead and on top of the body", () => {
    expect(lookYaw(from, 0, { x: 0, z: 5 }, 1)).toBeCloseTo(0);
    expect(lookYaw(from, 0, from, 1)).toBe(0);
  });

  it("turns toward +X like the facing does, relative to the body", () => {
    expect(lookYaw(from, 0, { x: 1, z: 1 }, 2)).toBeCloseTo(Math.PI / 4);
    expect(lookYaw(from, Math.PI / 2, { x: 1, z: 1 }, 2)).toBeCloseTo(-Math.PI / 4);
  });

  it("clamps, and takes the short way round", () => {
    expect(lookYaw(from, 0, { x: 0, z: -5 }, 1)).toBeCloseTo(-1);
    expect(lookYaw(from, 3, { x: 0, z: -5 }, 1)).toBeCloseTo(Math.PI - 3);
  });
});

describe("stepChain", () => {
  it("passes a swing down the chain, the tip later than the base, and settles", () => {
    const chain: Spring[] = [0, 1, 2, 3].map(() => ({ value: 0, velocity: 0 }));
    const peaks = chain.map(() => ({ at: 0, value: 0 }));
    for (let i = 0; i < 240; i++) {
      // A short push, then nothing.
      stepChain(chain, i < 12 ? 1 : 0, 2, 0.5, 1 / 60);
      chain.forEach((link, j) => {
        const peak = peaks[j] as { at: number; value: number };
        if (link.value > peak.value) {
          peak.value = link.value;
          peak.at = i;
        }
      });
    }
    for (let j = 1; j < chain.length; j++) {
      expect((peaks[j] as { at: number }).at).toBeGreaterThan((peaks[j - 1] as { at: number }).at);
    }
    for (const link of chain) expect(Math.abs(link.value)).toBeLessThan(0.02);
  });
});

describe("noise", () => {
  it("stays in [-1, 1], repeats for the same input, and moves smoothly", () => {
    let last = noise(0, 7);
    for (let x = 0; x < 50; x += 0.01) {
      const v = noise(x, 7);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - last)).toBeLessThan(0.05);
      last = v;
    }
    expect(noise(3.3, 7)).toBe(noise(3.3, 7));
    expect(noise(3.3, 7)).not.toBe(noise(3.3, 8));
  });
});

describe("flicks", () => {
  const options = { every: 2, chance: 0.5, length: 0.8 };
  const samples = Array.from({ length: 20000 }, (_, i) => flicks(i / 100, 3, options));

  it("is mostly still, with swings to both sides within [-1, 1]", () => {
    const still = samples.filter((v) => v === 0).length / samples.length;
    expect(still).toBeGreaterThan(0.6);
    expect(Math.max(...samples)).toBeGreaterThan(0.3);
    expect(Math.min(...samples)).toBeLessThan(-0.3);
    for (const v of samples) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it("swings about as often as asked", () => {
    let swings = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1] === 0 && samples[i] !== 0) swings++;
    }
    // 200 s in 2 s slots at a 50% chance: about 50 swings.
    expect(swings).toBeGreaterThan(35);
    expect(swings).toBeLessThan(65);
  });

  it("repeats for the same time", () => {
    expect(flicks(12.34, 3, options)).toBe(flicks(12.34, 3, options));
  });
});

describe("gaitBlend with a handover speed", () => {
  it("plays the upper gait alone from its `from` speed, slowed down", () => {
    const gaits: Gait[] = [
      GAITS[0] as Gait,
      GAITS[1] as Gait,
      { speed: 5, duration: 0.5, from: 3 },
    ];
    const cruise = gaitBlend(4, gaits, OPTIONS);
    expect(cruise.weights).toEqual([0, 0, 1]);
    expect(cruise.cyclesPerSecond).toBeCloseTo((4 / 5) * 2, 9); // 0.8× its own rate
    const between = gaitBlend(2, gaits, OPTIONS);
    expect(between.weights[1]).toBeGreaterThan(0);
    expect(between.weights[2]).toBeGreaterThan(0);
    expect(sum(between)).toBeCloseTo(1, 12);
  });
});

const DRIVER: DriverOptions = {
  ...OPTIONS,
  startPhase: 0.25,
  shuffleRate: 2,
  stopMax: 0.3,
  fade: 0.05,
};
/** A pose that's closest to standing at phases 0 and 0.5. */
const score = (phase: number) => Math.abs(Math.sin(2 * Math.PI * phase));
const run = (
  driver: ReturnType<typeof createGaitDriver>,
  speed: number,
  frames: number,
  shuffle = false,
) => {
  for (let i = 0; i < frames; i++) stepGaits(driver, speed, shuffle, GAITS, DRIVER, score, 1 / 120);
};

describe("stepGaits", () => {
  it("starts on the push-off foot, once, from standing", () => {
    const driver = createGaitDriver(GAITS.length);
    driver.phase = 0.9;
    stepGaits(driver, 2.5, false, GAITS, DRIVER, score, 1 / 120);
    expect(driver.started).toBe(true);
    expect(driver.phase).toBeGreaterThanOrEqual(0.25);
    expect(driver.phase).toBeLessThan(0.3);
    stepGaits(driver, 2.5, false, GAITS, DRIVER, score, 1 / 120);
    expect(driver.started).toBe(false);
  });

  it("finishes the step on a planted point before fading into the idle", () => {
    const driver = createGaitDriver(GAITS.length);
    run(driver, 2.5, 60);
    driver.phase = 0.3; // past 0.25: the next planted point is 0.5
    run(driver, 0, 1);
    expect(driver.mode).toBe("stop");
    expect(driver.weights[0]).toBeLessThan(0.1); // still striding, not idling
    run(driver, 0, 60);
    expect(driver.mode).toBe("idle");
    expect(Math.abs(driver.phase - 0.5)).toBeLessThanOrEqual(1 / 48); // sampled every 1/48
    run(driver, 0, 120);
    expect(driver.weights[0]).toBeCloseTo(1, 3);
    const phase = driver.phase;
    run(driver, 0, 30);
    expect(driver.phase).toBe(phase); // standing: the stride holds
  });

  it("doesn't stride on past stopMax to reach a planted point", () => {
    const driver = createGaitDriver(GAITS.length);
    run(driver, 2.5, 60);
    const rate = driver.rate;
    run(driver, 0, 240);
    expect(driver.mode).toBe("idle");
    // It strode at most stopMax at its pace (plus the one frame that stopped it).
    expect(rate * DRIVER.stopMax).toBeLessThan(1);
  });

  it("shuffles at the walk for short moves, and cross-fades when the move commits", () => {
    const driver = createGaitDriver(GAITS.length);
    run(driver, 2.5, 30, true);
    expect(driver.mode).toBe("shuffle");
    expect(driver.weights[1]).toBeGreaterThan(0.9);
    expect(driver.rate).toBeCloseTo(DRIVER.shuffleRate / (GAITS[0] as Gait).duration, 9);
    run(driver, 2.5, 60);
    expect(driver.mode).toBe("move");
    expect(driver.weights[3]).toBeGreaterThan(0.9);
  });

  it("weights always sum to 1", () => {
    const driver = createGaitDriver(GAITS.length);
    for (const [speed, shuffle] of [
      [2.5, true],
      [1, false],
      [0, false],
      [0.5, false],
      [0, true],
    ] as const) {
      run(driver, speed, 17, shuffle);
      expect(driver.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });
});

describe("nextStopPhase", () => {
  it("finds the best point ahead within the window, never behind", () => {
    // Checked every 1/48 of a cycle.
    expect(Math.abs(nextStopPhase(0.3, 1, score) - 0.2)).toBeLessThanOrEqual(1 / 96);
    expect(Math.abs(nextStopPhase(0.55, 1, score) - 0.45)).toBeLessThanOrEqual(1 / 96);
    expect(nextStopPhase(0.3, 0.1, score)).toBeLessThanOrEqual(0.1);
    expect(nextStopPhase(0.3, 0, score)).toBe(0);
  });
});

describe("pushOffCurve", () => {
  it("rises from 0 to 1 and back to 0", () => {
    expect(pushOffCurve(0, 0.2)).toBe(0);
    expect(pushOffCurve(0.1, 0.2)).toBeCloseTo(1, 9);
    expect(pushOffCurve(0.2, 0.2)).toBe(0);
    expect(pushOffCurve(0.05, 0.2)).toBeGreaterThan(0);
    expect(pushOffCurve(0.1, 0)).toBe(0);
  });
});

describe("stepBend", () => {
  const options = { frontFrequency: 8, frontDamping: 0.6, hipFrequency: 4, max: 0.7 };

  it("trails the hips behind the shoulders through a turn, then straightens", () => {
    const bend = createBend();
    for (let i = 0; i < 6; i++) stepBend(bend, Math.PI / 12, options, 1 / 60); // 90° in 0.1 s
    expect(bend.hips.value).toBeLessThan(bend.front.value);
    expect(bend.front.value).toBeLessThan(0);
    expect(bend.front.value - bend.hips.value).toBeLessThanOrEqual(options.max + 1e-9);
    for (let i = 0; i < 240; i++) stepBend(bend, 0, options, 1 / 60);
    expect(Math.abs(bend.front.value)).toBeLessThan(1e-3);
    expect(Math.abs(bend.hips.value)).toBeLessThan(1e-3);
  });

  it("barely depends on the frame rate", () => {
    const at = (fps: number) => {
      const bend = createBend();
      const frames = Math.round(fps * 0.1);
      for (let i = 0; i < frames; i++) stepBend(bend, Math.PI / 2 / frames, options, 1 / fps);
      for (let i = 0; i < Math.round(fps * 0.1); i++) stepBend(bend, 0, options, 1 / fps);
      return bend.hips.value;
    };
    expect(Math.abs(at(30) - at(144))).toBeLessThan(0.05);
  });

  it("never lags a reversal by more than three quarters of a half-turn", () => {
    const bend = createBend();
    for (let i = 0; i < 6; i++) stepBend(bend, Math.PI / 6, options, 1 / 60);
    expect(Math.abs(bend.front.value)).toBeLessThanOrEqual(Math.PI * 0.75 + 1e-9);
  });
});

describe("stepShuffle", () => {
  const options = { distance: 1, time: 0.12 };

  it("shuffles a short tap and commits a held key, until it wants nothing", () => {
    const gate = { time: 0, committed: false };
    expect(stepShuffle(gate, true, null, options, 0.05)).toBe(true);
    expect(stepShuffle(gate, true, null, options, 0.05)).toBe(true);
    expect(stepShuffle(gate, true, null, options, 0.05)).toBe(false);
    expect(stepShuffle(gate, true, null, options, 0.05)).toBe(false);
    expect(stepShuffle(gate, false, null, options, 0.05)).toBe(false);
    expect(stepShuffle(gate, true, null, options, 0.05)).toBe(true);
  });

  it("commits a right-click by its path's length", () => {
    expect(stepShuffle({ time: 0, committed: false }, true, 0.6, options, 1 / 60)).toBe(true);
    expect(stepShuffle({ time: 0, committed: false }, true, 3, options, 1 / 60)).toBe(false);
  });
});

/** A foot over 48 samples: lowest (planted) at `contact`, highest half a stride later. */
const foot = (contact: number, forward = 0) => ({
  height: Array.from({ length: 48 }, (_, i) => 1 - Math.cos(2 * Math.PI * (i / 48 - contact))),
  forward: Array.from(
    { length: 48 },
    (_, i) => forward * Math.cos(2 * Math.PI * (i / 48 - contact)),
  ),
});
const circular = (a: number, b: number) => Math.abs(a - b - Math.round(a - b));

describe("contactPhase", () => {
  it("finds when a foot is planted, around the loop", () => {
    for (const c of [0, 0.1, 0.5, 0.93])
      expect(circular(contactPhase(foot(c).height), c)).toBeLessThan(1e-4);
  });
});

describe("pairShift", () => {
  it("lands both feet together at 1 and leaves them be at 0", () => {
    const left = 0.1;
    const right = 0.35;
    const bound = pairShift(left, right, 1);
    // The left foot lands when phase + shift = left, the right when phase + shift = right.
    expect(circular(left - bound.left, right - bound.right)).toBeLessThan(1e-12);
    expect(pairShift(left, right, 0)).toEqual({ left: -0, right: 0 });
    // The short way round the loop.
    const wrapped = pairShift(0.95, 0.05, 1);
    expect(wrapped.left).toBeCloseTo(-0.05, 12);
    expect(wrapped.right).toBeCloseTo(0.05, 12);
  });
});

describe("strideMotion", () => {
  // Hind pair lands at 0, front pair at 0.5; each foot is furthest forward when it lands, so the
  // hind feet are forward and the front ones back at 0 (gathered).
  const feet: StrideFeet = {
    lh: foot(0, 1),
    rh: foot(0, 1),
    lf: foot(0.5, 1),
    rf: foot(0.5, 1),
  };
  const motion = strideMotion(feet);
  const at = (series: number[], phase: number) => sampleLoop(series, phase);

  it("stays in [-1, 1]", () => {
    for (const series of [motion.lift, motion.rock, motion.gather]) {
      for (const v of series) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("is low on the landings and high in between", () => {
    expect(at(motion.lift, 0)).toBeLessThan(at(motion.lift, 0.25));
    expect(at(motion.lift, 0.5)).toBeLessThan(at(motion.lift, 0.75));
  });

  it("rocks nose up on the hind feet and down on the front", () => {
    expect(at(motion.rock, 0)).toBeGreaterThan(0.5);
    expect(at(motion.rock, 0.5)).toBeLessThan(-0.5);
  });

  it("gathers with the hind feet forward", () => {
    expect(at(motion.gather, 0)).toBeGreaterThan(0.5);
    expect(at(motion.gather, 0.5)).toBeLessThan(-0.5);
  });
});
