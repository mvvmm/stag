import { addDemoGround } from "@/demo/ground.view";
import { STRESS, stressSim } from "@/demo/stress";
import type { SceneDef } from "@/scenes/scene";

export const stressScene: SceneDef = {
  ...stressSim,
  setup(ctx) {
    addDemoGround(ctx);
    // Spawn just ran with the current count. A slider drag fires many changes; restart at most
    // once per frame, when the count differs.
    const count = STRESS.count;
    ctx.onFrame(() => {
      if (STRESS.count !== count) ctx.restart();
    });
  },
};
