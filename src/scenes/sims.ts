import { inputTestSim } from "@/demo/inputTest";
import { stressSim } from "@/demo/stress";
import { arenaSim } from "@/scenes/arena";
import { createSceneRegistry } from "@/scenes/registry";
import type { SceneSim } from "@/scenes/sim";

/** Every scene's simulation half, Babylon-free (headless replays). Same ids as `scenes/index.ts`. */
export const sims = createSceneRegistry<SceneSim>([arenaSim, inputTestSim, stressSim], "arena");
