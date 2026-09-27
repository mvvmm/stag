import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { createWorld } from "@/ecs/world";
import { type Checkpoint, checksumWorld, diffCheckpoints } from "@/replay/checksum";
import { applyEvent, replayTunables, tunableValues } from "@/replay/events";
import { CHECKPOINT_TICKS, type ReplayFile } from "@/replay/format";
import { createPlayer } from "@/replay/player";
import { restoreSnapshot } from "@/replay/snapshot";
import type { SceneSim } from "@/scenes/sim";
import { createSimulation } from "@/systems/simulation";

export type Divergence = { tick: number; diff: string[] };

export type HeadlessResult = {
  /** The first checkpoint that didn't match, or null. */
  divergence: Divergence | null;
  /** The checkpoints this run produced (at the file's ticks, or the standard ones with `rewrite`). */
  checksums: Checkpoint[];
};

export type HeadlessOptions = {
  /** Runs a `sim: true` debug command; without it, a replay with commands fails. */
  runCommand?: (id: string) => void;
  /**
   * Don't compare: take fresh checkpoints where a recording would (every `CHECKPOINT_TICKS`,
   * before each event tick, at the end), for `pnpm replay:update`.
   */
  rewrite?: boolean;
};

/**
 * Runs a replay in Node, without Babylon: spawns the scene's sim with the recorded seed and
 * tick-0 tunables (or restores its start snapshot), feeds it the recorded input and events, and checks every checkpoint. Stops at
 * the first divergence. The game's tunables are restored afterwards.
 */
export function runReplay(
  file: ReplayFile,
  sims: { get(id: string): SceneSim | undefined },
  { runCommand, rewrite = false }: HeadlessOptions = {},
): HeadlessResult {
  const sim = sims.get(file.scene);
  if (!sim) throw new Error(`replay scene "${file.scene}" doesn't exist`);
  const command =
    runCommand ??
    ((id: string) => {
      throw new Error(`replay command "${id}" can't run headless`);
    });

  const saved = tunableValues();
  tuning.apply(replayTunables(file.tunables));
  try {
    const world = createWorld();
    const rng = createRng(file.seed);
    if (file.start) restoreSnapshot(file.start, world, rng);
    else sim.spawn(world, rng);
    const simulation = createSimulation(world, rng, sim.systems);
    const player = createPlayer(file);
    const eventTicks = new Set(file.events.map((event) => event.tick));
    const dt = 1 / file.tickHz;
    const checksums: Checkpoint[] = [];

    for (let tick = 0; ; tick++) {
      if (rewrite) {
        const due =
          (tick === 0 && !!file.start) ||
          (tick > 0 && tick % CHECKPOINT_TICKS === 0) ||
          eventTicks.has(tick) ||
          tick === file.ticks;
        if (due) checksums.push(checksumWorld(world, rng, tick));
      } else {
        const expected = player.expected(tick);
        if (expected) {
          const actual = checksumWorld(world, rng, tick);
          checksums.push(actual);
          const diff = diffCheckpoints(expected, actual);
          if (diff.length) return { divergence: { tick, diff }, checksums };
        }
      }
      if (tick >= file.ticks) break;
      for (const event of player.takeEvents()) applyEvent(world, event, command);
      simulation.step(dt, player.next());
    }
    return { divergence: null, checksums };
  } finally {
    tuning.apply(saved);
  }
}
