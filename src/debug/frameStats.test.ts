import { describe, expect, it } from "vitest";
import { createFrameStats } from "@/debug/frameStats";

const frame = (frameMs: number, phases: Record<string, number> = {}, cpuMs = 1) => ({
  frameMs,
  cpuMs,
  phases,
});

describe("frameStats", () => {
  it("buckets frame times with average and max, so a hitch shows up", () => {
    const stats = createFrameStats({ bucketSeconds: 0.1, bucketCount: 3 });
    for (let i = 0; i < 5; i++) stats.push(frame(10));
    expect(stats.graph()).toEqual([]);

    for (let i = 0; i < 4; i++) stats.push(frame(10));
    stats.push(frame(60)); // bucket reaches 0.15 s
    expect(stats.graph()).toEqual([{ avg: 15, max: 60 }]);
  });

  it("keeps only the latest buckets", () => {
    const stats = createFrameStats({ bucketSeconds: 0.01, bucketCount: 3 });
    for (const ms of [10, 20, 30, 40]) stats.push(frame(ms));
    expect(stats.graph().map((b) => b.avg)).toEqual([20, 30, 40]);
  });

  it("profiles phases per frame over a window, sorted by cost", () => {
    const stats = createFrameStats({ windowSeconds: 0.03 });
    stats.push(frame(10, { pawn: 0.2, render: 2 }, 3));
    stats.push(frame(10, { render: 4 }, 5)); // no tick this frame: pawn counts as 0
    expect(stats.profile()).toEqual([]);
    stats.push(frame(10, { pawn: 0.4, render: 3 }, 4));

    const profile = stats.profile();
    expect(profile.map((p) => p.name)).toEqual(["render", "pawn"]);
    expect(profile[0]).toEqual({ name: "render", avg: 3, max: 4 });
    expect(profile[1]?.avg).toBeCloseTo(0.2);
    expect(profile[1]?.max).toBeCloseTo(0.4);
    expect(stats.cpu()).toEqual({ avg: 4, max: 5 });
  });
});
