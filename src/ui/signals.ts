import { signal } from "@preact/signals";
import type { Vec2 } from "@/core/math";
import type { StatsMode } from "@/debug/persist";
import type { Action } from "@/input/actions";

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
  /** Actions held right now (live). */
  held: Action[];
  /** How many ticks have seen each action pressed; one per physical press. */
  pressCounts: Partial<Record<Action, number>>;
  /** Actions pressed within the last moment, for highlighting. */
  flashing: Action[];
};

/** Written by the input test scene; null while no scene publishes input stats. */
export const inputStats = signal<InputStats | null>(null);

/** Debug-tool state for the overlays; only written when the dev tools run. */
export type DebugState = {
  /** The dev tools are running (dev server or `?debug`). */
  active: boolean;
  stats: StatsMode;
  /** Show the live input overlay (the input test's actions, move mode and aim). */
  inputOverlay: boolean;
  /** The Babylon Inspector is open (it docks over the page, so the overlays step aside). */
  inspector: boolean;
};

export const debugState = signal<DebugState>({
  active: false,
  stats: "off",
  inputOverlay: false,
  inspector: false,
});

/** Rendering and profiler numbers for the full stats view (~4 Hz, only while it's shown). */
export type PerfStats = {
  /** Frame-time buckets (ms), oldest first: average and worst frame per bucket. */
  graph: { avg: number; max: number }[];
  cpu: { avg: number; max: number };
  /** GPU frame time in ms, when the adapter supports timestamp queries. */
  gpuMs: number | null;
  drawCalls: number;
  activeMeshes: number;
  totalMeshes: number;
  entities: number;
  /** JS heap in MB (Chrome only). */
  heapMb: number | null;
  /** Per-frame cost of each system and render phase, most expensive first. */
  profile: { name: string; avg: number; max: number }[];
};

export const perfStats = signal<PerfStats>({
  graph: [],
  cpu: { avg: 0, max: 0 },
  gpuMs: null,
  drawCalls: 0,
  activeMeshes: 0,
  totalMeshes: 0,
  entities: 0,
  heapMb: null,
  profile: [],
});
