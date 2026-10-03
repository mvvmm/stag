import {
  type AssetContainer,
  type InstantiatedEntries,
  LoadAssetContainerAsync,
  type Scene,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";

// The glTF models, loaded once at boot into asset containers (their meshes stay out of the scene);
// every scene setup instantiates its own copies synchronously, so restarts never reload a file.
// Built by `pnpm models:build` (scripts/build-models.ts); see CREDITS.md.

const MODELS = { tiger: "models/tiger.glb", guardian: "models/forest-guardian.glb" } as const;
export type ModelId = keyof typeof MODELS;

const containers = new Map<ModelId, AssetContainer>();

/**
 * Loads every model into `scene`'s asset containers. A model that fails to load is left out (with
 * a warning), and `instantiateModel` returns null for it, so the game still runs without it.
 */
export async function preloadModels(scene: Scene): Promise<void> {
  registerBuiltInLoaders();
  await Promise.all(
    Object.entries(MODELS).map(async ([id, path]) => {
      try {
        const container = await LoadAssetContainerAsync(
          `${import.meta.env.BASE_URL}${path}`,
          scene,
        );
        // Nothing plays on its own: the view samples the clips itself.
        for (const group of container.animationGroups) group.stop();
        containers.set(id as ModelId, container);
      } catch (error) {
        console.warn(`model ${id} (${path}) failed to load`, error);
      }
    }),
  );
}

/**
 * A copy of a model in the scene: its own nodes, skeleton and (stopped) animation groups, sharing
 * the container's materials and textures (or with its own copies of the materials, still sharing
 * the textures, with `cloneMaterials`: dispose those yourself). `dispose()` removes the copy; null
 * if it didn't load.
 */
export function instantiateModel(
  id: ModelId,
  { cloneMaterials = false }: { cloneMaterials?: boolean } = {},
): InstantiatedEntries | null {
  const container = containers.get(id);
  if (!container) return null;
  const entries = container.instantiateModelsToScene((name) => name, cloneMaterials, {
    doNotInstantiate: true,
  });
  for (const group of entries.animationGroups) group.stop();
  return entries;
}

/** The materials a model's copies share (e.g. for a material plugin); empty if it didn't load. */
export function modelMaterials(id: ModelId) {
  return containers.get(id)?.materials ?? [];
}
