import { fps } from "@/ui/signals";
import styles from "./SmokeLabel.module.css";

export function SmokeLabel() {
  return (
    <div class={styles.label}>
      Druid — scaffold OK · <span class={styles.fps}>{fps} fps</span>
    </div>
  );
}
