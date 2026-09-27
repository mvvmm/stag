import { describe, expect, it } from "vitest";
import { createFixedLoop } from "@/core/loop";

const setup = () => {
  const dts: number[] = [];
  const loop = createFixedLoop({
    tickHz: 60,
    maxFrameDelta: 0.25,
    maxTicksPerFrame: 5,
    update: (dt) => dts.push(dt),
  });
  return { loop, dts };
};

const DT = 1 / 60;

describe("createFixedLoop", () => {
  it("runs one tick per tick-length frame, always with the fixed dt", () => {
    const { loop, dts } = setup();
    for (let i = 0; i < 10; i++) expect(loop.advance(DT).ticks).toBe(1);
    expect(dts).toHaveLength(10);
    for (const dt of dts) expect(dt).toBe(DT);
    expect(loop.tickCount).toBe(10);
  });

  it("carries the remainder over and reports it as alpha", () => {
    const { loop } = setup();
    // 120 Hz display: every other frame runs a tick.
    let r = loop.advance(DT / 2);
    expect(r.ticks).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5);
    r = loop.advance(DT / 2);
    expect(r.ticks).toBe(1);
    expect(r.alpha).toBeCloseTo(0, 5);

    r = loop.advance(DT * 2.25);
    expect(r.ticks).toBe(2);
    expect(r.alpha).toBeCloseTo(0.25);
  });

  it("runs the right number of ticks over time for uneven frame deltas", () => {
    const { loop } = setup();
    const frames = [0.007, 0.013, 0.0166, 0.02, 0.009];
    let elapsed = 0;
    for (let i = 0; i < 200; i++) {
      const f = frames[i % frames.length] ?? 0;
      loop.advance(f);
      elapsed += f;
    }
    expect(loop.tickCount).toBe(Math.floor(elapsed / DT));
  });

  it("clamps long frames and caps ticks per frame, dropping the leftover", () => {
    const { loop } = setup();
    const r = loop.advance(10);
    expect(r.ticks).toBe(5);
    expect(r.alpha).toBeLessThan(1);
    // The dropped time doesn't come back on the next frame.
    expect(loop.advance(0).ticks).toBe(0);
  });

  it("ignores negative deltas", () => {
    const { loop } = setup();
    expect(loop.advance(-1).ticks).toBe(0);
    expect(loop.alpha).toBe(0);
  });

  it("runs no ticks and freezes alpha while paused", () => {
    const { loop } = setup();
    loop.advance(DT * 1.5);
    const alpha = loop.alpha;
    loop.paused = true;
    expect(loop.running).toBe(false);
    for (let i = 0; i < 5; i++) expect(loop.advance(DT)).toEqual({ ticks: 0, alpha });
  });

  it("treats autoPaused like paused, independently of paused", () => {
    const { loop } = setup();
    loop.paused = true;
    loop.autoPaused = true;
    loop.autoPaused = false;
    expect(loop.running).toBe(false);
    expect(loop.advance(DT).ticks).toBe(0);
  });

  it("discards the frame that spans a pause on resume", () => {
    const { loop } = setup();
    loop.advance(DT * 0.5);
    loop.autoPaused = true;
    loop.advance(DT);
    loop.autoPaused = false;
    // e.g. the first rAF after returning to a hidden tab reports a huge delta.
    const r = loop.advance(5);
    expect(r.ticks).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5);
    expect(loop.advance(DT / 2).ticks).toBe(1);
  });

  it("scales game time with timeScale", () => {
    const { loop } = setup();
    loop.timeScale = 0.25;
    for (let i = 0; i < 400; i++) loop.advance(DT);
    expect(loop.tickCount).toBe(100);

    loop.timeScale = 0;
    expect(loop.advance(DT).ticks).toBe(0);
  });
});
