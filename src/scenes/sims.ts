import { stressSim } from "@/demo/stress";
import { arenaSim, gymSim, yardSim } from "@/scenes/arena";
import { createSceneRegistry } from "@/scenes/registry";
import type { SceneSim } from "@/scenes/sim";

/** Every scene's simulation half, Babylon-free (headless replays). Same ids as `scenes/index.ts`. */
export const sims = createSceneRegistry<SceneSim>([yardSim, arenaSim, gymSim, stressSim], "yard");
