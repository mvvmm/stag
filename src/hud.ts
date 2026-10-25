import { abilityById } from "@/data/abilities";
import { type Entity, SLOTS } from "@/ecs/world";
import { controlLabel, type Preset } from "@/input/bindings";
import { type AbilitySlotView, abilityBar } from "@/ui/signals";

// Feeds the HUD's signals from the world, for the shell to call once a frame. The UI never reads
// the ECS itself (architecture rule 3), and the signal is only written when what it shows changes.

/** Cooldowns are shown to a tenth of a second, so the bar updates ~10 times a second at most. */
const round = (seconds: number) => Math.ceil(seconds * 10 - 1e-6) / 10;

let last = "";

/** Publishes the player's slots to `abilityBar` (empty without a casting player). */
export function publishAbilityBar(player: Entity | undefined, preset: Preset): void {
  const caster = player?.caster;
  const views: AbilitySlotView[] = caster
    ? SLOTS.map((slot) => {
        const state = caster.slots[slot];
        const def = state && abilityById(state.ability);
        const control = preset.actions[slot]?.[0];
        return {
          slot,
          key: control ? controlLabel(control) : null,
          label: def?.label ?? null,
          icon: def?.icon ?? null,
          cooldown: state && !player.noCooldowns ? round(Math.max(0, state.cooldown)) : 0,
          cooldownMax: def && player ? def.stats(player).cooldown : 0,
          aiming: player.player?.aiming?.slot === slot,
        };
      })
    : [];
  const key = JSON.stringify(views);
  if (key === last) return;
  last = key;
  abilityBar.value = views;
}
