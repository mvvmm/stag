import { inputTestScene } from "@/demo/inputTest.view";
import { stressScene } from "@/demo/stress.view";
import { arenaScene } from "@/scenes/arena.view";
import { createSceneRegistry } from "@/scenes/registry";
import type { SceneDef } from "@/scenes/scene";

/** Every scene, in the order the debug pane lists them. Production always starts the default. */
export const scenes = createSceneRegistry<SceneDef>(
  [arenaScene, inputTestScene, stressScene],
  "arena",
);
