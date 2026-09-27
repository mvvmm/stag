/** A list of scenes with a default, looked up by id. Generic so it's testable without Babylon. */
export function createSceneRegistry<S extends { id: string }>(
  scenes: readonly S[],
  defaultId: string,
) {
  const byId = new Map<string, S>();
  for (const scene of scenes) {
    if (byId.has(scene.id)) throw new Error(`duplicate scene id "${scene.id}"`);
    byId.set(scene.id, scene);
  }
  const fallback = byId.get(defaultId);
  if (!fallback) throw new Error(`default scene "${defaultId}" isn't registered`);

  return {
    list(): readonly S[] {
      return scenes;
    },

    get default(): S {
      return fallback;
    },

    get(id: string): S | undefined {
      return byId.get(id);
    },

    /** The scene with this id, or the default (flagged `unknown`) when there's no such scene. */
    resolve(id: string | null | undefined): { scene: S; unknown: boolean } {
      if (id === null || id === undefined) return { scene: fallback, unknown: false };
      const scene = byId.get(id);
      return scene ? { scene, unknown: false } : { scene: fallback, unknown: true };
    },
  };
}
