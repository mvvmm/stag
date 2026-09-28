import { notice } from "@/ui/signals";
import styles from "./Notice.module.css";

/** A short message at the bottom of the screen that fades out (e.g. "Controls: WASD"). */
export function Notice() {
  const n = notice.value;
  if (!n) return null;
  // Keyed by id, so the same text shown again restarts the fade.
  return (
    <div key={n.id} class={styles.notice}>
      {n.text}
    </div>
  );
}
