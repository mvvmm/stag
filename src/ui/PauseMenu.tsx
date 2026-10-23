import { menuActions, pauseMenu } from "@/ui/signals";
import styles from "./PauseMenu.module.css";

/**
 * The pause menu (Esc): resume. A placeholder for the 6.1 menus. Right-click is the only control
 * scheme since 2.2, so there's no scheme to pick (the debug pane can still switch to WASD).
 */
export function PauseMenu() {
  const { open } = pauseMenu.value;
  if (!open) return null;
  return (
    <div class={styles.backdrop}>
      <div class={styles.panel} role="dialog" aria-label="Paused">
        <h1 class={styles.title}>Paused</h1>
        <button type="button" class={styles.resume} onClick={() => menuActions.resume()}>
          Resume
        </button>
        <p class={styles.footnote}>
          <kbd>Esc</kbd> resumes
        </p>
      </div>
    </div>
  );
}
