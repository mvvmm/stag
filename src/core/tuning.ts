/**
 * Live-tunable values. Code declares a group with `defineTunables` and reads the returned plain
 * object every time it needs a value (never cache it), so edits from the debug pane apply at once.
 * DOM- and Babylon-free: simulation systems may declare tunables too. Code stays the source of
 * truth; the debug tools persist tweaks and can copy them back as a snippet.
 */

type Base = { label?: string };
export type NumberSpec = Base & { value: number; min?: number; max?: number; step?: number };
export type BooleanSpec = Base & { value: boolean };
export type SelectSpec = Base & { value: string; options: readonly string[] };
export type TunableSpec = NumberSpec | BooleanSpec | SelectSpec;

export type TunableValue = number | boolean | string;

type ValueOf<S extends TunableSpec> = S extends NumberSpec
  ? number
  : S extends BooleanSpec
    ? boolean
    : string;

export type TunableValues<S extends Record<string, TunableSpec>> = {
  [K in keyof S]: ValueOf<S[K]>;
};

export type Tunable = {
  /** `group.key`, e.g. `pawn.speed`. */
  id: string;
  group: string;
  key: string;
  spec: TunableSpec;
  default: TunableValue;
  value: TunableValue;
};

export type TunableChange = { id: string; from: TunableValue; to: TunableValue };

type Group = {
  name: string;
  specs: Record<string, TunableSpec>;
  values: Record<string, TunableValue>;
};

const isNumberSpec = (spec: TunableSpec): spec is NumberSpec => typeof spec.value === "number";
const isSelectSpec = (spec: TunableSpec): spec is SelectSpec => "options" in spec;

/** Drops float noise from slider steps (0.30000000000000004 → 0.3). */
const tidy = (value: number): number => Number(value.toPrecision(6));

/**
 * `value` if it's valid for `spec`, else undefined. Numbers outside the range are rejected, or
 * clamped when `clamp` is set (interactive edits clamp; stale stored tweaks are dropped).
 */
function validate(spec: TunableSpec, value: unknown, clamp: boolean): TunableValue | undefined {
  if (isNumberSpec(spec)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const min = spec.min ?? -Infinity;
    const max = spec.max ?? Infinity;
    if (value < min || value > max)
      return clamp ? tidy(Math.min(max, Math.max(min, value))) : undefined;
    return tidy(value);
  }
  if (isSelectSpec(spec)) {
    return typeof value === "string" && spec.options.includes(value) ? value : undefined;
  }
  return typeof value === "boolean" ? value : undefined;
}

export type TuningRegistry = ReturnType<typeof createTuningRegistry>;

export function createTuningRegistry() {
  const groups = new Map<string, Group>();
  const listeners = new Set<(id: string | null) => void>();
  /** Fires with the changed id, or null when groups were (re)defined. */
  const emit = (id: string | null) => {
    for (const listener of listeners) listener(id);
  };

  const split = (id: string): [Group, string] | undefined => {
    const dot = id.lastIndexOf(".");
    const group = groups.get(id.slice(0, dot));
    const key = id.slice(dot + 1);
    return group && key in group.specs ? [group, key] : undefined;
  };

  const entry = (group: Group, key: string): Tunable => {
    const spec = group.specs[key] as TunableSpec;
    return {
      id: `${group.name}.${key}`,
      group: group.name,
      key,
      spec,
      default: spec.value,
      value: group.values[key] as TunableValue,
    };
  };

  const list = (): Tunable[] =>
    [...groups.values()].flatMap((group) =>
      Object.keys(group.specs).map((key) => entry(group, key)),
    );

  const setValue = (id: string, value: unknown, clamp: boolean): boolean => {
    const found = split(id);
    if (!found) return false;
    const [group, key] = found;
    const valid = validate(group.specs[key] as TunableSpec, value, clamp);
    if (valid === undefined) return false;
    if (group.values[key] !== valid) {
      group.values[key] = valid;
      emit(id);
    }
    return true;
  };

  return {
    /**
     * Declares a group and returns its live values. Defining a group again (e.g. after a module
     * reloads) replaces it and carries over tweaked values that are still valid.
     */
    define<S extends Record<string, TunableSpec>>(name: string, specs: S): TunableValues<S> {
      const previous = groups.get(name);
      const values: Record<string, TunableValue> = {};
      for (const [key, spec] of Object.entries(specs)) {
        const old = previous?.values[key];
        const tweaked = old !== undefined && old !== previous?.specs[key]?.value;
        values[key] = (tweaked ? validate(spec, old, false) : undefined) ?? spec.value;
      }
      groups.set(name, { name, specs, values });
      emit(null);
      return values as TunableValues<S>;
    },

    list,

    get(id: string): TunableValue | undefined {
      const found = split(id);
      return found ? found[0].values[found[1]] : undefined;
    },

    /** Sets a value (numbers are clamped to the range). False if the id or value is invalid. */
    set(id: string, value: unknown): boolean {
      return setValue(id, value, true);
    },

    /** Resets one value (`group.key`), one group (`group`) or everything (no argument). */
    reset(target?: string): void {
      for (const tunable of list()) {
        const matches = target === undefined || tunable.id === target || tunable.group === target;
        if (matches) setValue(tunable.id, tunable.default, false);
      }
    },

    /** Values that differ from their code defaults. */
    changes(): TunableChange[] {
      return list()
        .filter((tunable) => tunable.value !== tunable.default)
        .map(({ id, default: from, value: to }) => ({ id, from, to }));
    },

    /** Changed values by id, for storage. */
    overrides(): Record<string, TunableValue> {
      return Object.fromEntries(this.changes().map(({ id, to }) => [id, to]));
    },

    /**
     * Applies stored overrides. Entries that no longer fit (unknown id, wrong type, out of range)
     * are skipped and returned, so stale tweaks never break anything.
     */
    apply(overrides: Record<string, unknown>): string[] {
      const dropped: string[] = [];
      for (const [id, value] of Object.entries(overrides)) {
        if (!setValue(id, value, false)) dropped.push(id);
      }
      return dropped;
    },

    /** Subscribes to changes; the listener gets the changed id, or null after a (re)definition. */
    onChange(listener: (id: string | null) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A snippet of the changed values to paste back into code, one `id: from → to` per line. */
export function formatChanges(changes: readonly TunableChange[]): string {
  if (!changes.length) return "";
  const show = (value: TunableValue) => (typeof value === "string" ? `"${value}"` : String(value));
  return changes.map(({ id, from, to }) => `${id}: ${show(from)} → ${show(to)}`).join("\n");
}

/** The game's tunables. */
export const tuning = createTuningRegistry();

/** Declares a group of live-tunable values in the game's registry. See `createTuningRegistry`. */
export function defineTunables<S extends Record<string, TunableSpec>>(
  name: string,
  specs: S,
): TunableValues<S> {
  return tuning.define(name, specs);
}
