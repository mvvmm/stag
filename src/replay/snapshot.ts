import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";

/**
 * The simulation state at one moment, so a recording can start mid-run ("New recording"):
 * every entity's components (in `world.entities` order) and the RNG state. Components must be
 * plain data (numbers, strings, booleans, null, arrays, plain objects); anything else can't be
 * restored exactly, so snapshotting it throws.
 */
export type WorldSnapshot = {
  /** The live tick it was taken at (informational; the recording counts from 0). */
  tick: number;
  rng: [number, number, number, number];
  /** Entities as JSON-safe data (see `encode`). */
  entities: unknown[];
};

// JSON can't hold -0, NaN, ±Infinity or undefined, and the checksum tells them apart, so they
// are written as small marker objects.
const MARK = "$";
const special = (value: number | undefined): string | null => {
  if (value === undefined) return "undefined";
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return null;
};
const SPECIAL_VALUES: Record<string, number | undefined> = {
  undefined: undefined,
  "-0": -0,
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Plain data → JSON-safe data. Throws on anything that isn't plain data. */
export function encode(value: unknown, path = "entity"): unknown {
  if (value === undefined || typeof value === "number") {
    const mark = special(value);
    return mark === null ? value : { [MARK]: mark };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item, i) => encode(item, `${path}[${i}]`));
  if (typeof value === "object" && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encode(item, `${path}.${key}`)]),
    );
  }
  throw new Error(`${path} isn't plain data (${typeof value}), so it can't be snapshotted`);
}

/** The inverse of `encode`. */
export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === MARK && typeof record[MARK] === "string") {
      return SPECIAL_VALUES[record[MARK] as string];
    }
    return Object.fromEntries(keys.map((key) => [key, decode(record[key])]));
  }
  return value;
}

export function snapshotWorld(world: World<Entity>, rng: Rng, tick: number): WorldSnapshot {
  return {
    tick,
    rng: rng.state(),
    entities: world.entities.map((entity, i) => encode(entity, `entity #${i}`)),
  };
}

/** Fills an empty world and sets the RNG from a snapshot (instead of the scene's spawn). */
export function restoreSnapshot(snapshot: WorldSnapshot, world: World<Entity>, rng: Rng): void {
  for (const entity of snapshot.entities) world.add(decode(entity) as Entity);
  rng.setState(snapshot.rng);
}
