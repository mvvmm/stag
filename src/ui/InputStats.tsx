import type { Vec2 } from "@/core/math";
import { ACTIONS } from "@/input/actions";
import { debugState, inputStats } from "@/ui/signals";
import styles from "./InputStats.module.css";

const fmt = (v: Vec2) => `(${v.x.toFixed(2)}, ${v.z.toFixed(2)})`;

/** Live input for the input test scene. A debug overlay, toggled from the debug pane. */
export function InputStats() {
  const { active, inputOverlay, inspector } = debugState.value;
  const s = inputStats.value;
  if (!active || !inputOverlay || inspector || !s) return null;

  return (
    <div class={styles.panel}>
      <div>
        preset <span class={styles.value}>{s.preset}</span>
      </div>
      <div>
        move <span class={styles.value}>{fmt(s.move)}</span> · moveCmd{" "}
        <span class={styles.value}>{s.moveCommand ? fmt(s.moveCommand) : "–"}</span>
      </div>
      <div>
        aim <span class={styles.value}>{fmt(s.aim)}</span>
      </div>
      <div class={styles.actions}>
        {ACTIONS.map((action) => (
          <span
            key={action}
            class={[
              styles.action,
              s.held.includes(action) ? styles.held : "",
              s.flashing.includes(action) ? styles.flash : "",
            ].join(" ")}
          >
            {action} {s.pressCounts[action] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}
