import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { TunableValue } from "@/core/tuning";
import type { Entity } from "@/ecs/world";
import { ACTIONS, type InputFrame } from "@/input/actions";
import { QUANT } from "@/input/quantize";
import { type Checkpoint, checksumWorld } from "@/replay/checksum";
import {
  CHECKPOINT_TICKS,
  createInputDecoder,
  createInputEncoder,
  FORMAT,
  MAX_TICKS,
  type ReplayEvent,
  type ReplayEventData,
  type ReplayFile,
  VERSION,
} from "@/replay/format";

export type RecordingHeader = {
  scene: string;
  seed: number;
  /** Every tunable's value at tick 0. */
  tunables: Record<string, TunableValue>;
  takenOverAt?: number;
};

/** Build and time info that goes into a saved file. */
export type FileMeta = { commit: string; dirty: boolean; recordedAt: string; tickHz: number };

export type Recorder = ReturnType<typeof createRecorder>;

/**
 * Records one scene run from tick 0: the input of every tick, out-of-band events, and
 * checkpoints (every `CHECKPOINT_TICKS`, before each event tick, at the end). Stops at `cap`
 * ticks. Pure: the caller passes the world and RNG to fingerprint.
 */
export function createRecorder(header: RecordingHeader, { cap = MAX_TICKS } = {}) {
  const encoder = createInputEncoder();
  const events: ReplayEvent[] = [];
  const checksums: Checkpoint[] = [];
  let full = false;

  const checkpoint = (world: World<Entity>, rng: Rng) => {
    const tick = encoder.ticks;
    if (checksums[checksums.length - 1]?.tick === tick) return;
    checksums.push(checksumWorld(world, rng, tick));
  };

  return {
    header,
    events,
    checksums,
    /** Ticks recorded. */
    get ticks() {
      return encoder.ticks;
    },
    /** The cap was reached: nothing more is recorded. */
    get full() {
      return full;
    },

    /** Call after each tick with the input it ran with. */
    tick(frame: InputFrame, world: World<Entity>, rng: Rng): void {
      if (full) return;
      encoder.push(frame);
      if (encoder.ticks % CHECKPOINT_TICKS === 0) checkpoint(world, rng);
      if (encoder.ticks >= cap) {
        full = true;
        checkpoint(world, rng);
      }
    },

    /**
     * Call right *before* applying an out-of-band change between ticks: it's stamped with the
     * next tick, and the state before it is fingerprinted. False once the recording is full.
     */
    event(data: ReplayEventData, world: World<Entity>, rng: Rng): boolean {
      if (full) return false;
      checkpoint(world, rng);
      events.push({ ...data, tick: encoder.ticks } as ReplayEvent);
      return true;
    },

    /**
     * The recording as a file. Events after the last tick are dropped (no tick ever saw them),
     * and the world passed in fingerprints the end unless a checkpoint already covers it.
     */
    toFile(meta: FileMeta, world: World<Entity>, rng: Rng): ReplayFile {
      const ticks = encoder.ticks;
      const saved = [...checksums];
      if (saved[saved.length - 1]?.tick !== ticks) saved.push(checksumWorld(world, rng, ticks));
      return {
        format: FORMAT,
        v: VERSION,
        ...meta,
        scene: header.scene,
        seed: header.seed,
        actions: [...ACTIONS],
        quant: QUANT,
        ticks,
        ...(header.takenOverAt !== undefined ? { takenOverAt: header.takenOverAt } : {}),
        tunables: { ...header.tunables },
        input: [...encoder.data],
        events: events.filter((event) => event.tick < ticks),
        checksums: saved,
      };
    },

    /** Copies ticks from a replay (for take over), before anything is recorded live. */
    importPrefix(file: ReplayFile, ticks: number, fingerprints: readonly Checkpoint[]): void {
      const decoder = createInputDecoder(file.input, file.actions);
      for (let i = 0; i < ticks; i++) encoder.push(decoder.next());
      events.push(...file.events.filter((event) => event.tick < ticks));
      checksums.push(...fingerprints.filter((c) => c.tick <= ticks));
    },
  };
}

/** A recorder that continues a replay live from `ticks` (take over). */
export function recorderFromReplay(
  file: ReplayFile,
  ticks: number,
  fingerprints: readonly Checkpoint[],
): Recorder {
  const recorder = createRecorder({
    scene: file.scene,
    seed: file.seed,
    tunables: file.tunables,
    takenOverAt: ticks,
  });
  recorder.importPrefix(file, ticks, fingerprints);
  return recorder;
}
