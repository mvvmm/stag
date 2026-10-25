import type { World } from "miniplex";
import { TEST_KIT_SLOTS } from "@/data/testKit";
import type { Entity, SlotId } from "@/ecs/world";

// Cheats that change the simulation. They live here, Babylon-free, so headless replays can run them
// too: the debug pane defines one `sim: true` command per entry (recorded like any sim command),
// and `runReplay` looks them up by id.

export type SimCommand = {
  label: string;
  run: (world: World<Entity>) => void;
};

export const simCommands: Record<string, SimCommand> = {
  "cheats.noclip": {
    label: "Noclip",
    run(world) {
      const player = world.with("player").first;
      if (!player) return;
      if (player.noclip) world.removeComponent(player, "noclip");
      else world.addComponent(player, "noclip", true);
    },
  },
  "cheats.noCooldowns": {
    label: "No cooldowns",
    run(world) {
      const player = world.with("player").first;
      if (!player) return;
      if (player.noCooldowns) world.removeComponent(player, "noCooldowns");
      else world.addComponent(player, "noCooldowns", true);
    },
  },
  "cheats.testKit": {
    label: "Test kit",
    run(world) {
      const player = world.with("player", "caster").first;
      if (!player) return;
      const { slots } = player.caster;
      if (player.testKit) {
        for (const slot of player.testKit) delete slots[slot];
        const aiming = player.player.aiming;
        if (aiming && player.testKit.includes(aiming.slot)) delete player.player.aiming;
        world.removeComponent(player, "testKit");
        return;
      }
      // Only the empty slots: whatever the loadout already has stays.
      const filled: SlotId[] = [];
      for (const [slot, ability] of Object.entries(TEST_KIT_SLOTS) as [SlotId, string][]) {
        if (slots[slot]) continue;
        slots[slot] = { ability, cooldown: 0 };
        filled.push(slot);
      }
      world.addComponent(player, "testKit", filled);
    },
  },
};
