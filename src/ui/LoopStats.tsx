import { loopStats } from "@/ui/signals";
import styles from "./LoopStats.module.css";

export function LoopStats() {
  const s = loopStats.value;
  const state = s.paused ? "paused" : s.autoPaused ? "auto-paused" : "running";

  return (
    <div class={styles.panel}>
      <div>
        <span class={styles.value}>{s.fps}</span> fps ·{" "}
        <span class={styles.value}>{s.tickRate}</span> ticks/s · α{" "}
        <span class={styles.value}>{s.alpha.toFixed(2)}</span>
      </div>
      <div>
        <span class={s.paused || s.autoPaused ? styles.warn : styles.value}>{state}</span> · ×
        {s.timeScale} · interp{" "}
        <span class={s.interpolate ? styles.value : styles.warn}>
          {s.interpolate ? "on" : "off"}
        </span>
      </div>
      <div class={styles.keys}>[I] interpolation · [Esc] pause · [T] time scale</div>
    </div>
  );
}
