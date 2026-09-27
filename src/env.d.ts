/// <reference types="vite/client" />

import type { DebugDraw } from "@/core/debugDraw";
import type { FixedLoop } from "@/core/loop";
import type { Rng } from "@/core/rng";
import type { TuningRegistry } from "@/core/tuning";
import type { CommandRegistry } from "@/debug/commands";
import type { DevTools } from "@/debug/devtools";
import type { ReplayMode } from "@/debug/replay/session";
import type { Entity } from "@/ecs/world";
import type { InputState } from "@/input/state";
import type { ReplayFile } from "@/replay/format";
import type { Divergence } from "@/replay/headless";
import type { Shell } from "@/shell";

declare global {
  /** Git commit of the build (short hash), for replay files. Set by vite.config.ts. */
  const __COMMIT__: string;
  /** Whether the build had uncommitted changes. */
  const __DIRTY__: boolean;

  interface Window {
    /**
     * Debug handle for the browser console and agent-browser checks. Only set when the dev tools
     * run (`pnpm dev` or `?debug`).
     */
    __game?: {
      /** The current scene's world (a new one after every load). */
      readonly world: Shell["world"];
      loop: FixedLoop;
      readonly rng: Rng;
      /** The Babylon scene (see `scenes` for game scenes). */
      scene: Shell["scene"];
      scenes: {
        /** Registered scene ids. */
        list(): string[];
        current(): { id: string; seed: number } | null;
        /** Loads a scene with a seed (fresh by default). False if there's no such scene. */
        load(id: string, seed?: number): boolean;
        /** Restarts the current scene with the same seed, or the given one. */
        restart(seed?: number): void;
      };
      /** The current scene's seed. */
      readonly seed: number | null;
      /** The entity selected in the pane, if any. */
      readonly selected: Entity | null;
      /** Selects an entity (or an id in the current world); null deselects. */
      select(target: Entity | number | null): void;
      input: InputState;
      tunables: Pick<TuningRegistry, "list" | "get" | "set" | "reset" | "changes">;
      debugDraw: DebugDraw;
      commands: CommandRegistry;
      /** Runs a debug command by id, e.g. `__game.run("stats.cycle")`. */
      run(id: string): boolean;
      /** Record & replay (every load is recorded; see `debug/replay/session.ts`). */
      replay: {
        /** The current recording as a replay file (or the replay being played). */
        recording(): ReplayFile | null;
        /** Plays a replay: a file object, gzipped/plain JSON bytes, or a URL. */
        play(source: ReplayFile | Uint8Array | string): Promise<boolean>;
        /** Goes to a tick of the playing replay; resolves once there. */
        seek(tick: number): Promise<void>;
        stepBack(): Promise<void>;
        takeOver(): void;
        exit(): void;
        /** Stops the live recording (saving keeps it). */
        stop(): void;
        /** Forgets the recording and records from right now (world snapshot). False if it can't. */
        newRecording(): boolean;
        /** Downloads the current recording; resolves with the file name. */
        save(): Promise<string | null>;
        readonly status: {
          mode: ReplayMode;
          tick: number;
          ticks: number;
          diverged: Divergence | null;
          seeking: boolean;
          notice: string;
        };
      };
      tools: DevTools;
    };
  }
}
