import { stressScene } from "@/demo/stress.view";
import { arenaScene, gymScene } from "@/scenes/arena.view";
import { createSceneRegistry } from "@/scenes/registry";
import type { SceneDef } from "@/scenes/scene";

/** Every scene, in the order the debug pane lists them. Production always starts the default. */
export const scenes = createSceneRegistry<SceneDef>([arenaScene, gymScene, stressScene], "arena");
