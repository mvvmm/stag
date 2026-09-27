import { debugState } from "@/ui/signals";
import styles from "./DevOverlay.module.css";

/** The DEV badge while dev-keys mode is on, and the dev-key cheat sheet. */
export function DevOverlay() {
  const { active, devMode, help, keys } = debugState.value;
  if (!active || !devMode) return null;

  const groups = [...new Set(keys.map((k) => k.group))];
  return (
    <>
      <div class={styles.badge}>DEV · keys go to the tools · [`] back to game</div>
      {help && (
        <div class={styles.help}>
          {groups.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              <dl>
                {keys
                  .filter((k) => k.group === group)
                  .map((k) => (
                    <div key={k.key}>
                      <dt>{k.key}</dt>
                      <dd>{k.label}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
