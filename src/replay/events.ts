import type { World } from "miniplex";
import { type TunableValue, tuning } from "@/core/tuning";
import { setPath } from "@/debug/inspect";
import { type Entity, snapTransform } from "@/ecs/world";
import type { ReplayEvent } from "@/replay/format";

/** An entity-pane edit, addressed by the entity's index in `world.entities`. */
export type Edit = { entity: number; path: string[]; value: unknown };

/**
 * Applies an edit. Transform edits also snap `prevTransform`, so the move doesn't smear across a
 * frame. False if the entity or the field's parent is gone.
 */
export function applyEdit(world: World<Entity>, { entity, path, value }: Edit): boolean {
  const target = world.entities[entity];
  if (!target || !setPath(target, path, value)) return false;
  if (path[0] === "transform") snapTransform(target);
  return true;
}

/**
 * Applies a recorded event: tunables go to the game's registry, edits to the world, commands to
 * `runCommand` (the debug command registry in the browser; headless runs pass their own).
 */
export function applyEvent(
  world: World<Entity>,
  event: ReplayEvent,
  runCommand: (id: string, world: World<Entity>) => void,
): void {
  switch (event.kind) {
    case "tunable":
      tuning.apply({ [event.id]: event.value });
      break;
    case "edit":
      applyEdit(world, event);
      break;
    case "command":
      runCommand(event.id, world);
      break;
  }
}

/**
 * The tunables a replay runs with: the recorded values, and code defaults for tunables the
 * recording didn't have (added since), so the player's own tweaks never leak into a replay.
 */
export function replayTunables(
  recorded: Record<string, TunableValue>,
): Record<string, TunableValue> {
  const defaults = Object.fromEntries(
    tuning.list().map((tunable) => [tunable.id, tunable.default]),
  );
  return { ...defaults, ...recorded };
}

/** Every tunable's current value by id. */
export function tunableValues(): Record<string, TunableValue> {
  return Object.fromEntries(tuning.list().map((tunable) => [tunable.id, tunable.value]));
}
