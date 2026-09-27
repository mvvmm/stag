import { debugState, replayStatus } from "@/ui/signals";
import styles from "./ReplayBadge.module.css";

const clock = (ticks: number, hz: number) => {
  const seconds = Math.floor(ticks / hz);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

/** "▶ REPLAY 00:42 / 03:10" while a replay plays, so it's never mistaken for live play. */
export function ReplayBadge() {
  const { inspector } = debugState.value;
  const s = replayStatus.value;
  if (!s || inspector) return null;
  return (
    <div class={styles.badge}>
      <span class={styles.label}>▶ REPLAY</span> {clock(s.tick, s.tickHz)} /{" "}
      {clock(s.ticks, s.tickHz)}
      {s.seeking !== null && <span class={styles.muted}> · seeking {s.seeking}%</span>}
      {s.diverged !== null && <span class={styles.diverged}> · ✗ diverged at {s.diverged}</span>}
    </div>
  );
}
