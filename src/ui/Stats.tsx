import { debugState, loopStats, perfStats } from "@/ui/signals";
import styles from "./Stats.module.css";

const GRAPH_WIDTH = 240;
const GRAPH_HEIGHT = 40;
/** The graph's top edge in ms: two 60 Hz frames, so a dropped frame reaches halfway. */
const GRAPH_MS = 33.3;

const ms = (value: number) => value.toFixed(value < 10 ? 2 : 1);

/** Frame-time graph: a bar per bucket, the average solid and the worst frame as a faint cap. */
function FrameGraph({ graph }: { graph: { avg: number; max: number }[] }) {
  const barWidth = GRAPH_WIDTH / 60;
  const y = (value: number) => GRAPH_HEIGHT - Math.min(value / GRAPH_MS, 1) * GRAPH_HEIGHT;
  const offset = GRAPH_WIDTH - graph.length * barWidth;
  return (
    <svg
      class={styles.graph}
      width={GRAPH_WIDTH}
      height={GRAPH_HEIGHT}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      aria-label="frame time"
    >
      <line class={styles.graphLine} x1={0} x2={GRAPH_WIDTH} y1={y(16.7)} y2={y(16.7)} />
      {graph.map((bucket, i) => {
        const x = offset + i * barWidth;
        const slow = bucket.max > 20;
        return (
          <g key={i} class={slow ? styles.slow : styles.bar}>
            <rect
              x={x}
              y={y(bucket.max)}
              width={barWidth - 1}
              height={GRAPH_HEIGHT - y(bucket.max)}
              opacity={0.35}
            />
            <rect
              x={x}
              y={y(bucket.avg)}
              width={barWidth - 1}
              height={GRAPH_HEIGHT - y(bucket.avg)}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function Stats() {
  const { active, stats: mode, inspector } = debugState.value;
  if (!active || mode === "off" || inspector) return null;
  const s = loopStats.value;
  const state = s.paused ? "paused" : s.autoPaused ? "auto-paused" : "running";

  return (
    <div class={styles.panel}>
      <div>
        <span class={styles.value}>{s.fps}</span> fps ·{" "}
        <span class={styles.value}>{s.tickRate}</span> ticks/s ·{" "}
        <span class={s.paused || s.autoPaused ? styles.warn : styles.value}>{state}</span>
        {s.timeScale !== 1 && <span class={styles.warn}> ×{s.timeScale}</span>}
        {!s.interpolate && <span class={styles.warn}> · interp off</span>}
      </div>
      {mode === "full" && <FullStats alpha={s.alpha} />}
    </div>
  );
}

function FullStats({ alpha }: { alpha: number }) {
  const p = perfStats.value;
  return (
    <>
      <FrameGraph graph={p.graph} />
      <div>
        cpu <span class={styles.value}>{ms(p.cpu.avg)}</span>/{ms(p.cpu.max)} ms · gpu{" "}
        <span class={styles.value}>{p.gpuMs === null ? "n/a" : ms(p.gpuMs)}</span> ms · α{" "}
        <span class={styles.value}>{alpha.toFixed(2)}</span>
      </div>
      <div>
        <span class={styles.value}>{p.drawCalls}</span> draws ·{" "}
        <span class={styles.value}>{p.activeMeshes}</span>/{p.totalMeshes} meshes ·{" "}
        <span class={styles.value}>{p.entities}</span> entities
        {p.heapMb !== null && (
          <>
            {" "}
            · <span class={styles.value}>{p.heapMb.toFixed(0)}</span> MB
          </>
        )}
      </div>
      <table class={styles.profile}>
        <tbody>
          {p.profile.map((phase) => (
            <tr key={phase.name}>
              <td>{phase.name}</td>
              <td class={styles.value}>{ms(phase.avg)}</td>
              <td class={styles.muted}>{ms(phase.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
