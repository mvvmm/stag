/**
 * Collects per-frame timings into low-frequency summaries for the stats overlay: frame-time
 * buckets for the graph (average and max, so single hitches still show) and per-phase profiler
 * numbers over a rolling window. DOM-free; the shell does the timing.
 */

/** One frame's timings in milliseconds. */
export type FrameSample = {
  /** Wall time since the previous frame. */
  frameMs: number;
  /** Time spent in our frame callback (simulation + render submission). */
  cpuMs: number;
  /** Named phases: simulation systems (summed over the frame's ticks) and render phases. */
  phases: Readonly<Record<string, number>>;
};

export type Bucket = { avg: number; max: number };
export type PhaseStat = { name: string; avg: number; max: number };

type Acc = { total: number; max: number };

export type FrameStatsOptions = {
  bucketSeconds?: number;
  bucketCount?: number;
  windowSeconds?: number;
};

export function createFrameStats({
  bucketSeconds = 0.25,
  bucketCount = 60,
  windowSeconds = 1,
}: FrameStatsOptions = {}) {
  const buckets: Bucket[] = [];
  let bucket = { time: 0, frames: 0, total: 0, max: 0 };

  let span = { time: 0, frames: 0, cpu: { total: 0, max: 0 }, phases: new Map<string, Acc>() };
  let profile: PhaseStat[] = [];
  let cpu: Bucket = { avg: 0, max: 0 };

  const add = (acc: Acc, value: number) => {
    acc.total += value;
    acc.max = Math.max(acc.max, value);
  };

  return {
    push(sample: FrameSample): void {
      const seconds = sample.frameMs / 1000;

      bucket.time += seconds;
      bucket.frames++;
      bucket.total += sample.frameMs;
      bucket.max = Math.max(bucket.max, sample.frameMs);
      if (bucket.time >= bucketSeconds) {
        buckets.push({ avg: bucket.total / bucket.frames, max: bucket.max });
        if (buckets.length > bucketCount) buckets.shift();
        bucket = { time: 0, frames: 0, total: 0, max: 0 };
      }

      span.time += seconds;
      span.frames++;
      add(span.cpu, sample.cpuMs);
      for (const [name, ms] of Object.entries(sample.phases)) {
        let acc = span.phases.get(name);
        if (!acc) {
          acc = { total: 0, max: 0 };
          span.phases.set(name, acc);
        }
        add(acc, ms);
      }
      if (span.time >= windowSeconds) {
        const frames = span.frames;
        cpu = { avg: span.cpu.total / frames, max: span.cpu.max };
        profile = [...span.phases]
          .map(([name, acc]) => ({ name, avg: acc.total / frames, max: acc.max }))
          .sort((a, b) => b.avg - a.avg);
        span = { time: 0, frames: 0, cpu: { total: 0, max: 0 }, phases: new Map() };
      }
    },

    /** Completed frame-time buckets, oldest first. */
    graph(): readonly Bucket[] {
      return buckets;
    },

    /** Per-frame cost of each phase over the last completed window, most expensive first. */
    profile(): readonly PhaseStat[] {
      return profile;
    },

    /** CPU frame time over the last completed window. */
    cpu(): Bucket {
      return cpu;
    },
  };
}
