import type { Action, InputFrame } from "@/input/actions";
import type { Shell } from "@/shell";
import { inputStats } from "@/ui/signals";

// Publishes the live input overlay (what the simulation saw on its latest tick, held actions and
// press counts) in every scene. Press counts start over on every load.

const STATS_INTERVAL = 0.1;
/** How long a pressed action stays highlighted in the overlay, in seconds (wall clock). */
const FLASH_SECONDS = 0.3;

export function attachInputOverlay(shell: Shell): () => void {
  const { input } = shell;
  // What the simulation saw on its latest tick (the recorded input during a replay).
  let lastTick: InputFrame | undefined;
  let dirty = true;
  let statsTimer = 0;
  let pressCounts: Partial<Record<Action, number>> = {};
  let lastPressedAt: Partial<Record<Action, number>> = {};

  const offLoad = shell.onLoad(() => {
    lastTick = undefined;
    pressCounts = {};
    lastPressedAt = {};
    dirty = true;
  });

  const offTick = shell.onTick((tick) => {
    lastTick = tick;
    const now = performance.now() / 1000;
    for (const action of tick.pressed) {
      pressCounts[action] = (pressCounts[action] ?? 0) + 1;
      lastPressedAt[action] = now;
    }
    if (tick.pressed.size || tick.released.size || tick.moveCommand) dirty = true;
  });

  let lastFrameAt = performance.now() / 1000;
  const offFrame = shell.onFrame((frame) => {
    if (frame.pressed.size) dirty = true;

    const now = performance.now() / 1000;
    statsTimer += now - lastFrameAt;
    lastFrameAt = now;
    if (!dirty && statsTimer < STATS_INTERVAL) return;
    statsTimer = 0;
    dirty = false;

    inputStats.value = {
      preset: input.preset.label,
      move: lastTick?.move ?? { x: 0, z: 0 },
      moveCommand: lastTick?.moveCommand ?? null,
      aim: lastTick?.aim ?? input.aim,
      held: [...frame.held],
      pressCounts: { ...pressCounts },
      flashing: (Object.keys(lastPressedAt) as Action[]).filter(
        (action) => now - (lastPressedAt[action] ?? 0) < FLASH_SECONDS,
      ),
    };
  });

  return () => {
    offLoad();
    offTick();
    offFrame();
    inputStats.value = null;
  };
}
