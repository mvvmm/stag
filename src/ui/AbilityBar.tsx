import { AbilityIcon } from "@/ui/abilityIcons";
import { type AbilitySlotView, abilityBar } from "@/ui/signals";
import styles from "./AbilityBar.module.css";

// The ability bar (minimal, until the HUD in 2.6): the auto attack, Q/W/E/R and D/F, each with
// its icon, key and cooldown. Read-only: the bar is click-through like the rest of the overlay.

/** The auto attack sits apart, then the loadout, then the reserved slots. */
const GROUPS = [
  ["primary"],
  ["ability1", "ability2", "ability3", "ultimate"],
  ["extra1", "extra2"],
];

const seconds = (s: number) => (s < 1 ? s.toFixed(1) : String(Math.ceil(s)));

function Slot({ view }: { view: AbilitySlotView }) {
  const { label, cooldown, cooldownMax } = view;
  const cooling = cooldown > 0 && cooldownMax > 0;
  const classes = [
    styles.slot,
    !label && styles.empty,
    cooling && styles.cooling,
    view.aiming && styles.aiming,
  ];
  return (
    <div class={classes.filter(Boolean).join(" ")} title={label ?? "Empty"}>
      {label && (
        <div class={styles.icon}>
          <AbilityIcon icon={view.icon} label={label} />
        </div>
      )}
      {cooling && (
        <>
          <div
            class={styles.sweep}
            style={{ "--left": String(Math.min(1, cooldown / cooldownMax)) }}
          />
          <div class={styles.seconds}>{seconds(cooldown)}</div>
        </>
      )}
      {view.key && <div class={styles.key}>{view.key}</div>}
    </div>
  );
}

export function AbilityBar() {
  const slots = abilityBar.value;
  if (slots.length === 0) return null;
  const bySlot = new Map(slots.map((view) => [view.slot, view]));
  return (
    <div class={styles.bar}>
      {GROUPS.map((group) => (
        <div class={styles.group} key={group[0]}>
          {group.map((slot) => {
            const view = bySlot.get(slot);
            return view && <Slot key={slot} view={view} />;
          })}
        </div>
      ))}
    </div>
  );
}
