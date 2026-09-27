/** Where the dev tools start: `?scene=` / `?seed=` (debug-only, read once), else remembered. */

const UINT32_MAX = 0xffffffff;

/** A seed typed by a person or given in the URL: a decimal uint32, else null. */
export function parseSeed(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const seed = Number(trimmed);
  return seed <= UINT32_MAX ? seed : null;
}

export type Startup = {
  /** Scene id to start, if anything asked for one (it may not exist). */
  sceneId: string | undefined;
  seed: number;
  /** The `?seed=` value when it wasn't a valid seed (so a fresh one was used). */
  invalidSeed: string | null;
};

/**
 * `?scene=` wins over the last scene the dev tools remember. `?seed=` pins the seed; otherwise
 * `freshSeed` is used, so every load gets a new one.
 */
export function resolveStartup(
  params: URLSearchParams,
  storedScene: string | undefined,
  freshSeed: number,
): Startup {
  const sceneId = params.get("scene") ?? storedScene;
  const seedParam = params.get("seed");
  const seed = parseSeed(seedParam);
  return {
    sceneId: sceneId || undefined,
    seed: seed ?? freshSeed,
    invalidSeed: seedParam !== null && seed === null ? seedParam : null,
  };
}
