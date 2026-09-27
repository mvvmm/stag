/// <reference types="vite/client" />

import type { DebugDraw } from "@/core/debugDraw";
import type { FixedLoop } from "@/core/loop";
import type { Rng } from "@/core/rng";
import type { TuningRegistry } from "@/core/tuning";
import type { CommandRegistry } from "@/debug/commands";
import type { DevTools } from "@/debug/devtools";
import type { InputState } from "@/input/state";
import type { Shell } from "@/shell";

declare global {
  interface Window {
    /**
     * Debug handle for the browser console and agent-browser checks. Only set when the dev tools
     * run (`pnpm dev` or `?debug`).
     */
    __game?: {
      world: Shell["world"];
      loop: FixedLoop;
      rng: Rng;
      scene: Shell["scene"];
      input: InputState;
      tunables: Pick<TuningRegistry, "list" | "get" | "set" | "reset" | "changes">;
      debugDraw: DebugDraw;
      commands: CommandRegistry;
      /** Runs a debug command by id, e.g. `__game.run("stats.cycle")`. */
      run(id: string): boolean;
      tools: DevTools;
    };
  }
}
