import { castBar } from "@/ui/signals";
import styles from "./CastBar.module.css";

// The cast bar (minimal, like League's): over the ability bar while an ability winds up (filling)
// or channels (draining), so the moment you can't move reads on screen. Auto attacks never show.

export function CastBar() {
  const cast = castBar.value;
  if (!cast) return null;
  return (
    <div class={styles.bar}>
      <div
        class={cast.phase === "channel" ? styles.channel : styles.fill}
        style={{ width: `${cast.fill * 100}%` }}
      />
      <div class={styles.label}>{cast.label}</div>
    </div>
  );
}
