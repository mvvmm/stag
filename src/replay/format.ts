import type { TunableValue } from "@/core/tuning";
import { ACTIONS, type Action, type InputFrame } from "@/input/actions";
import { fromQuantUnits, QUANT, toQuantUnits } from "@/input/quantize";
import type { Checkpoint } from "@/replay/checksum";
import type { WorldSnapshot } from "@/replay/snapshot";

/**
 * The replay file: everything needed to run a scene again tick for tick (scene, seed, tunables
 * at tick 0, per-tick input, out-of-band events) plus checkpoints to verify it did. Saved as
 * gzipped JSON (`.replay.json.gz`). Only valid for the code it was recorded on.
 */
export type ReplayFile = {
  format: typeof FORMAT;
  v: typeof VERSION;
  /** Git commit of the build that recorded it (`dirty` if it had uncommitted changes). */
  commit: string;
  dirty: boolean;
  /** ISO timestamp, informational. */
  recordedAt: string;
  scene: string;
  seed: number;
  tickHz: number;
  /** Action names in bit order for the `held`/`pressed`/`released` masks. */
  actions: string[];
  /** Input values are stored as integers in units of 1/`quant`. */
  quant: number;
  /** Ticks recorded. */
  ticks: number;
  /** Set when the recording continued live from a replay at this tick ("take over"). */
  takenOverAt?: number;
  /**
   * Set when the recording started mid-run ("New recording"): the world to restore instead of
   * spawning the scene. Without it, the recording starts at the scene's tick 0.
   */
  start?: WorldSnapshot;
  /** Every tunable's value at tick 0 (before the scene spawned). */
  tunables: Record<string, TunableValue>;
  /** Delta-encoded input, see `createInputEncoder`. */
  input: number[];
  /** Out-of-band sim mutations, in order, each applied right before its tick runs. */
  events: ReplayEvent[];
  /** Every 60th tick, before each event tick, and at the end (and at 0 when it has a `start`). */
  checksums: Checkpoint[];
};

/** An out-of-band change to the simulation, applied before tick `tick` runs. */
export type ReplayEvent =
  | { tick: number; kind: "tunable"; id: string; value: TunableValue }
  /** An entity-pane edit: the entity by its index in `world.entities`, a field path, a value. */
  | { tick: number; kind: "edit"; entity: number; path: string[]; value: unknown }
  /** A debug command marked `sim: true`. */
  | { tick: number; kind: "command"; id: string };

type WithoutTick<E> = E extends ReplayEvent ? Omit<E, "tick"> : never;
/** An event before it's stamped with the tick it happened at. */
export type ReplayEventData = WithoutTick<ReplayEvent>;

export const FORMAT = "stag-replay";
export const VERSION = 1;
/** A checkpoint every this many ticks (1 s at 60 Hz). */
export const CHECKPOINT_TICKS = 60;
/** Recordings stop after 60 minutes at 60 Hz. */
export const MAX_TICKS = 60 * 60 * 60;

// --- Input encoding -----------------------------------------------------------------------------
//
// A flat list of change records. Each record is: ticks since the previous record's tick (the
// first counts from tick 0), a field mask, then only the fields in the mask, in bit order. A tick
// without a record repeats the previous tick's input. Positions are integers in 1/QUANT units,
// action sets are bitmasks over `actions`.

const MOVE = 1;
const MOVE_COMMAND = 2;
const MOVE_COMMAND_NONE = 4;
const AIM = 8;
const HELD = 16;
const PRESSED = 32;
const RELEASED = 64;

type Packed = {
  moveX: number;
  moveZ: number;
  /** null: no move command. */
  command: [number, number] | null;
  aimX: number;
  aimZ: number;
  held: number;
  pressed: number;
  released: number;
};

const EMPTY: Packed = {
  moveX: 0,
  moveZ: 0,
  command: null,
  aimX: 0,
  aimZ: 0,
  held: 0,
  pressed: 0,
  released: 0,
};

const ACTION_BIT = new Map<Action, number>(ACTIONS.map((action, i) => [action, 1 << i]));

const toMask = (actions: ReadonlySet<Action>): number => {
  let mask = 0;
  for (const action of actions) mask |= ACTION_BIT.get(action) ?? 0;
  return mask;
};

const pack = (frame: InputFrame): Packed => ({
  moveX: toQuantUnits(frame.move.x),
  moveZ: toQuantUnits(frame.move.z),
  command: frame.moveCommand
    ? [toQuantUnits(frame.moveCommand.x), toQuantUnits(frame.moveCommand.z)]
    : null,
  aimX: toQuantUnits(frame.aim.x),
  aimZ: toQuantUnits(frame.aim.z),
  held: toMask(frame.held),
  pressed: toMask(frame.pressed),
  released: toMask(frame.released),
});

/** Appends one tick's input at a time to a delta-encoded list. */
export function createInputEncoder() {
  const data: number[] = [];
  let last = EMPTY;
  let lastRecordTick = 0;
  let ticks = 0;

  return {
    data,
    get ticks() {
      return ticks;
    },
    push(frame: InputFrame): void {
      const next = pack(frame);
      let mask = 0;
      const fields: number[] = [];
      if (next.moveX !== last.moveX || next.moveZ !== last.moveZ) {
        mask |= MOVE;
        fields.push(next.moveX, next.moveZ);
      }
      const [lastCommand, command] = [last.command, next.command];
      if (
        command &&
        (!lastCommand || command[0] !== lastCommand[0] || command[1] !== lastCommand[1])
      ) {
        mask |= MOVE_COMMAND;
        fields.push(command[0], command[1]);
      } else if (!command && lastCommand) {
        mask |= MOVE_COMMAND_NONE;
      }
      if (next.aimX !== last.aimX || next.aimZ !== last.aimZ) {
        mask |= AIM;
        fields.push(next.aimX, next.aimZ);
      }
      if (next.held !== last.held) {
        mask |= HELD;
        fields.push(next.held);
      }
      if (next.pressed !== last.pressed) {
        mask |= PRESSED;
        fields.push(next.pressed);
      }
      if (next.released !== last.released) {
        mask |= RELEASED;
        fields.push(next.released);
      }
      if (mask) {
        data.push(ticks - lastRecordTick, mask, ...fields);
        lastRecordTick = ticks;
      }
      last = next;
      ticks++;
    },
  };
}

/**
 * Reads encoded input back one tick at a time. `actions` is the file's action order; names this
 * build doesn't know are dropped.
 */
export function createInputDecoder(data: readonly number[], actions: readonly string[]) {
  const actionAt = actions.map((name) =>
    (ACTIONS as readonly string[]).includes(name) ? (name as Action) : null,
  );
  const toSet = (mask: number): Set<Action> => {
    const set = new Set<Action>();
    actionAt.forEach((action, i) => {
      if (action && mask & (1 << i)) set.add(action);
    });
    return set;
  };

  let state: Packed = EMPTY;
  let cursor = 0;
  let tick = 0;
  let nextRecordTick = data.length ? (data[0] as number) : Number.POSITIVE_INFINITY;

  const read = (): number => {
    const value = data[cursor++];
    if (value === undefined) throw new Error("replay input ends mid-record");
    return value;
  };

  return {
    /** The tick the next `next()` returns. */
    get tick() {
      return tick;
    },
    next(): InputFrame {
      if (tick === nextRecordTick) {
        cursor++; // the tick delta, already in nextRecordTick
        const mask = read();
        const next = { ...state };
        if (mask & MOVE) {
          next.moveX = read();
          next.moveZ = read();
        }
        if (mask & MOVE_COMMAND) next.command = [read(), read()];
        if (mask & MOVE_COMMAND_NONE) next.command = null;
        if (mask & AIM) {
          next.aimX = read();
          next.aimZ = read();
        }
        if (mask & HELD) next.held = read();
        if (mask & PRESSED) next.pressed = read();
        if (mask & RELEASED) next.released = read();
        state = next;
        const delta = data[cursor];
        nextRecordTick = delta === undefined ? Number.POSITIVE_INFINITY : tick + delta;
      }
      tick++;
      return {
        move: { x: fromQuantUnits(state.moveX), z: fromQuantUnits(state.moveZ) },
        moveCommand: state.command
          ? { x: fromQuantUnits(state.command[0]), z: fromQuantUnits(state.command[1]) }
          : null,
        aim: { x: fromQuantUnits(state.aimX), z: fromQuantUnits(state.aimZ) },
        held: toSet(state.held),
        pressed: toSet(state.pressed),
        released: toSet(state.released),
      };
    },
  };
}

// --- Parsing ------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => Number.isInteger(value);

/** Checks a parsed replay file's shape. Throws with a readable message when it's not one. */
export function parseReplay(data: unknown, tickHz: number): ReplayFile {
  if (!isObject(data) || data.format !== FORMAT) throw new Error("not a replay file");
  if (data.v !== VERSION) throw new Error(`unsupported replay version ${String(data.v)}`);
  if (data.tickHz !== tickHz) {
    throw new Error(`replay runs at ${String(data.tickHz)} Hz, this build at ${tickHz} Hz`);
  }
  if (data.quant !== QUANT) throw new Error(`replay quantization ${String(data.quant)} ≠ ${QUANT}`);
  const bad = (field: string) => new Error(`replay file has an invalid "${field}"`);
  if (typeof data.scene !== "string") throw bad("scene");
  if (!isInt(data.seed) || data.seed < 0) throw bad("seed");
  if (!isInt(data.ticks) || data.ticks < 0) throw bad("ticks");
  if (!Array.isArray(data.actions) || !data.actions.every((a) => typeof a === "string")) {
    throw bad("actions");
  }
  if (!isObject(data.tunables)) throw bad("tunables");
  if (!Array.isArray(data.input) || !data.input.every(isInt)) throw bad("input");
  if (!Array.isArray(data.events) || !data.events.every((e) => isObject(e) && isInt(e.tick))) {
    throw bad("events");
  }
  if (
    data.start !== undefined &&
    !(
      isObject(data.start) &&
      Array.isArray(data.start.entities) &&
      Array.isArray(data.start.rng) &&
      data.start.rng.length === 4 &&
      data.start.rng.every(isInt)
    )
  ) {
    throw bad("start");
  }
  if (
    !Array.isArray(data.checksums) ||
    !data.checksums.every((c) => isObject(c) && isInt(c.tick) && isObject(c.components))
  ) {
    throw bad("checksums");
  }
  return {
    ...(data as ReplayFile),
    commit: typeof data.commit === "string" ? data.commit : "unknown",
    dirty: data.dirty === true,
    recordedAt: typeof data.recordedAt === "string" ? data.recordedAt : "",
  };
}
