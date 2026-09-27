import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";

/**
 * A fingerprint of the simulation state after a given number of ticks: the entity count, the RNG
 * state and one hash per component type. Comparing per component tells *what* diverged, not
 * just when.
 */
export type Checkpoint = {
  /** Ticks run when it was taken (it's the state before any events of tick `tick`). */
  tick: number;
  entities: number;
  rng: number;
  components: Record<string, number>;
};

/** Derived render bookkeeping, not simulation state. */
const SKIPPED = new Set(["prevTransform"]);

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new DataView(new ArrayBuffer(8));

/** FNV-1a over the 4 bytes of a uint32. */
function mix(hash: number, word: number): number {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h ^= (word >>> shift) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

// Type tags, so e.g. `1`, `true` and `"1"` hash differently.
const TAG = { undefined: 1, null: 2, false: 3, true: 4, number: 5, string: 6, array: 7, object: 8 };

/** Hashes plain data: numbers by their exact bits, objects with sorted keys. */
function hashValue(hash: number, value: unknown): number {
  if (value === undefined) return mix(hash, TAG.undefined);
  if (value === null) return mix(hash, TAG.null);
  if (typeof value === "boolean") return mix(hash, value ? TAG.true : TAG.false);
  if (typeof value === "number") {
    scratch.setFloat64(0, value);
    return mix(mix(mix(hash, TAG.number), scratch.getUint32(0)), scratch.getUint32(4));
  }
  if (typeof value === "string") return hashString(mix(hash, TAG.string), value);
  if (Array.isArray(value)) {
    let h = mix(mix(hash, TAG.array), value.length);
    for (const item of value) h = hashValue(h, item);
    return h;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    let h = mix(hash, TAG.object);
    for (const key of Object.keys(record).sort()) {
      h = hashValue(hashString(h, key), record[key]);
    }
    return h;
  }
  // Functions, symbols, bigints: shouldn't be in components; hash the type so it's noticed.
  return hashString(hash, typeof value);
}

function hashString(hash: number, text: string): number {
  let h = mix(hash, text.length);
  for (let i = 0; i < text.length; i++) h = mix(h, text.charCodeAt(i));
  return h;
}

/** Fingerprints the world and RNG. Entities are hashed by their index in `world.entities`. */
export function checksumWorld(world: World<Entity>, rng: Rng, tick: number): Checkpoint {
  const components: Record<string, number> = {};
  world.entities.forEach((entity, index) => {
    const record = entity as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (value === undefined || SKIPPED.has(key)) continue;
      components[key] = hashValue(mix(components[key] ?? FNV_OFFSET, index), value);
    }
  });
  let rngHash = FNV_OFFSET;
  for (const word of rng.state()) rngHash = mix(rngHash, word);
  const sorted = Object.fromEntries(
    Object.keys(components)
      .sort()
      .map((key) => [key, components[key] as number]),
  );
  return { tick, entities: world.entities.length, rng: rngHash, components: sorted };
}

/**
 * What differs between an expected and an actual checkpoint: component names, plus `entities`
 * and `rng` when those do. Empty when they match.
 */
export function diffCheckpoints(expected: Checkpoint, actual: Checkpoint): string[] {
  const diffs: string[] = [];
  if (expected.entities !== actual.entities) diffs.push("entities");
  if (expected.rng !== actual.rng) diffs.push("rng");
  const keys = new Set([...Object.keys(expected.components), ...Object.keys(actual.components)]);
  for (const key of [...keys].sort()) {
    if (expected.components[key] !== actual.components[key]) diffs.push(key);
  }
  return diffs;
}
