import { inputTestScene } from "@/demo/inputTest.view";
import { stressScene } from "@/demo/stress.view";
import { createSceneRegistry } from "@/scenes/registry";
import type { SceneDef } from "@/scenes/scene";

/** Every scene, in the order the debug pane lists them. Production always starts the default. */
export const scenes = createSceneRegistry<SceneDef>([inputTestScene, stressScene], "input-test");
