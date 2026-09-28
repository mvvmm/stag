import { tuning } from "@/core/tuning";
import type { CommandRegistry } from "@/debug/commands";

/** The `player` tunables a preset sets; speed and radius stay as they are. */
const FEEL = ["accel", "decel", "turnAccel", "turnRate"] as const;

type Feel = Record<(typeof FEEL)[number], number>;

/**
 * Named movement feels to A/B quickly: each sets the acceleration and turning tunables at once.
 * They go through `tuning`, so a replay records them like any other tunable change. Listed from the
 * sharpest to the heaviest; Balanced is the code defaults.
 */
const PRESETS: [id: string, label: string, values: Feel | null][] = [
  ["movement.instant", "Instant", { accel: 1000, decel: 1000, turnAccel: 1000, turnRate: 3600 }],
  ["movement.snappy", "Snappy", { accel: 120, decel: 175, turnAccel: 175, turnRate: 720 }],
  ["movement.balanced", "Balanced (defaults)", null],
  ["movement.weighty", "Weighty", { accel: 25, decel: 30, turnAccel: 40, turnRate: 360 }],
];

export function defineMovementPresets(commands: CommandRegistry): void {
  for (const [id, label, values] of PRESETS) {
    commands.define({
      id,
      label,
      group: "Movement",
      run: () => {
        for (const key of FEEL) {
          const value = values?.[key];
          if (value === undefined) tuning.reset(`player.${key}`);
          else tuning.set(`player.${key}`, value);
        }
      },
    });
  }
}
