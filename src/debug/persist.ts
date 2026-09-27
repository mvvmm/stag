/** Debug-tool settings remembered across reloads, under one versioned localStorage key. */

export const STATS_MODES = ["off", "compact", "full"] as const;
export type StatsMode = (typeof STATS_MODES)[number];

export type DebugSettings = {
  v: 1;
  /** Pane folders by title path (the pane itself is `Debug`), true when expanded. */
  paneFolders: Record<string, boolean>;
  stats: StatsMode;
  draw: { enabled: boolean; categories: Record<string, boolean> };
  wireframe: boolean;
  /** The live input overlay (the input test's actions, move mode and aim). */
  inputOverlay: boolean;
  /** Tunable overrides by id (`pawn.speed`). */
  tunables: Record<string, unknown>;
};

const STORAGE_KEY = "stag.debug";

export function defaultDebugSettings(): DebugSettings {
  return {
    v: 1,
    paneFolders: {},
    stats: "compact",
    draw: { enabled: false, categories: {} },
    wireframe: false,
    inputOverlay: true,
    tunables: {},
  };
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const boolRecord = (value: unknown): Record<string, boolean> =>
  isObject(value)
    ? (Object.fromEntries(
        Object.entries(value).filter(([, v]) => typeof v === "boolean"),
      ) as Record<string, boolean>)
    : {};

/**
 * Parses stored settings. Anything missing, malformed or from another version falls back to the
 * defaults field by field, so a bad value never takes the debug tools down.
 */
export function parseDebugSettings(raw: string | null): DebugSettings {
  const defaults = defaultDebugSettings();
  let data: unknown;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isObject(data) || data.v !== 1) return defaults;

  const draw = isObject(data.draw) ? data.draw : {};
  return {
    v: 1,
    paneFolders: boolRecord(data.paneFolders),
    stats: STATS_MODES.includes(data.stats as StatsMode)
      ? (data.stats as StatsMode)
      : defaults.stats,
    draw: {
      enabled: bool(draw.enabled, defaults.draw.enabled),
      categories: boolRecord(draw.categories),
    },
    wireframe: bool(data.wireframe, defaults.wireframe),
    inputOverlay: bool(data.inputOverlay, defaults.inputOverlay),
    tunables: isObject(data.tunables) ? data.tunables : {},
  };
}

export function loadDebugSettings(): DebugSettings {
  try {
    return parseDebugSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultDebugSettings();
  }
}

export function saveDebugSettings(settings: DebugSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode etc.): settings just aren't remembered.
  }
}
