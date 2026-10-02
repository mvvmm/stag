import { tuning } from "@/core/tuning";
import type { CommandRegistry } from "@/debug/commands";

/** The `anim` tunables a gallop preset sets: how much of a bound it is and the body's motion. */
const GALLOP = ["bound", "bounce", "rock", "flex", "stretch"] as const;

type Gallop = Record<(typeof GALLOP)[number], number>;

/**
 * Named gallop styles to A/B quickly (1.7). They go through `tuning`, so a replay records them like
 * any other tunable change. Natural is the code defaults.
 */
const PRESETS: [id: string, label: string, values: Gallop | null][] = [
  ["gallop.natural", "Natural (defaults)", null],
  ["gallop.pouncy", "Pouncy", { bound: 1, bounce: 0.18, rock: 12, flex: 32, stretch: 0.6 }],
];

export function defineGallopPresets(commands: CommandRegistry): void {
  for (const [id, label, values] of PRESETS) {
    commands.define({
      id,
      label,
      group: "Gallop",
      run: () => {
        for (const key of GALLOP) {
          const value = values?.[key];
          if (value === undefined) tuning.reset(`anim.${key}`);
          else tuning.set(`anim.${key}`, value);
        }
      },
    });
  }
}
