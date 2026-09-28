import type { World } from "miniplex";
import type { Entity } from "@/ecs/world";

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
};
