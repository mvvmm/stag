import { PRESETS, type PresetId } from "@/input/bindings";
import { menuActions, pauseMenu } from "@/ui/signals";
import styles from "./PauseMenu.module.css";

const CHOICES: { id: PresetId; label: string; hint: string }[] = [
  { id: "mmo", label: "WASD", hint: "Steer with the keys" },
  { id: "moba", label: "Right-click", hint: "Click where to go" },
];

/** The pause menu (Esc): resume, and the control scheme. A placeholder for the 6.1 menus. */
export function PauseMenu() {
  const { open, controls } = pauseMenu.value;
  if (!open) return null;
  return (
    <div class={styles.backdrop}>
      <div class={styles.panel} role="dialog" aria-label="Paused">
        <h1 class={styles.title}>Paused</h1>
        <button type="button" class={styles.resume} onClick={() => menuActions.resume()}>
          Resume
        </button>
        <fieldset class={styles.controls}>
          <legend class={styles.legend}>Controls</legend>
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              class={choice.id === controls ? `${styles.choice} ${styles.picked}` : styles.choice}
              aria-pressed={choice.id === controls}
              title={PRESETS[choice.id].label}
              onClick={() => menuActions.setControls(choice.id)}
            >
              <span class={styles.choiceLabel}>{choice.label}</span>
              <span class={styles.choiceHint}>{choice.hint}</span>
            </button>
          ))}
        </fieldset>
        <p class={styles.footnote}>
          <kbd>M</kbd> switches anytime · <kbd>Esc</kbd> resumes
        </p>
      </div>
    </div>
  );
}
