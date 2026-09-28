import type { CommandRegistry } from "@/debug/commands";
import type { Shell } from "@/shell";
import { simCommands } from "@/systems/cheats";

/**
 * One `sim: true` command per sim cheat (`systems/cheats.ts`), so they're recorded and replayed.
 * They have dedicated controls in the Gameplay folder instead of buttons.
 */
export function defineCheats(commands: CommandRegistry, shell: Shell): void {
  for (const [id, { label, run }] of Object.entries(simCommands)) {
    commands.define({
      id,
      label,
      group: "Cheats",
      sim: true,
      button: false,
      run: () => run(shell.world),
    });
  }
}
