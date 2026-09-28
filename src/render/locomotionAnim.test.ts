import { describe, expect, it } from "vitest";
import {
  bankAngle,
  clipTime,
  type Gait,
  gaitBlend,
  lookYaw,
  type Spring,
  snapSpring,
  stepChain,
  stepSpring,
  sway,
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

describe("sway", () => {
  it("stays in [-1, 1] and doesn't repeat every main period", () => {
    let min = 0;
    let max = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const v = sway(t, 0.3);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(sway(1, 0.3)).not.toBeCloseTo(sway(1 + 1 / 0.3, 0.3), 3);
  });
});
