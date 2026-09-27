import { MAX_FRAME_DELTA, MAX_TICKS_PER_FRAME, TICK_HZ } from "@/core/constants";
import { createFixedLoop, type FixedLoop } from "@/core/loop";
import { createRng, type Rng } from "@/core/rng";
import { createWorld } from "@/ecs/world";
import { createEngine } from "@/render/engine";
import { createMeshSync } from "@/render/meshSync";
import { createScene } from "@/render/scene";
import { createSimulation } from "@/systems/simulation";
import { loopStats } from "@/ui/signals";

const STATS_INTERVAL = 0.25;

export type Shell = {
  world: ReturnType<typeof createWorld>;
  rng: Rng;
  loop: FixedLoop;
  settings: { interpolate: boolean };
  /** Pushes the current loop state to the UI now (e.g. after a key toggles something). */
  publishStats(): void;
};

/**
 * Wires the simulation, the fixed-step loop and the Babylon renderer together. This is the only
 * place that reads wall-clock time; the simulation only ever sees the fixed tick `dt`.
 */
export async function startShell(canvas: HTMLCanvasElement, seed: number): Promise<Shell> {
  const world = createWorld();
  const rng = createRng(seed);
  const simulation = createSimulation(world, rng);
  const loop = createFixedLoop({
    tickHz: TICK_HZ,
    maxFrameDelta: MAX_FRAME_DELTA,
    maxTicksPerFrame: MAX_TICKS_PER_FRAME,
    update: simulation.step,
  });
  const settings = { interpolate: true };

  const engine = await createEngine(canvas);
  const scene = createScene(engine);
  const meshSync = createMeshSync(world, scene);

  // Auto-pause while the tab is hidden or the window is unfocused; independent of a manual pause.
  const updateAutoPause = () => {
    loop.autoPaused = document.hidden || !document.hasFocus();
    publishStats();
  };
  document.addEventListener("visibilitychange", updateAutoPause);
  window.addEventListener("blur", updateAutoPause);
  window.addEventListener("focus", updateAutoPause);

  let statsTimer = 0;
  let statsTicks = loop.tickCount;
  let tickRate = 0;
  const publishStats = () => {
    loopStats.value = {
      fps: Number.isFinite(engine.getFps()) ? Math.round(engine.getFps()) : 0,
      tickRate,
      alpha: loop.alpha,
      paused: loop.paused,
      autoPaused: loop.autoPaused,
      timeScale: loop.timeScale,
      interpolate: settings.interpolate,
    };
  };

  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const frameSeconds = (now - last) / 1000;
    last = now;

    const { alpha } = loop.advance(frameSeconds);
    meshSync.sync(settings.interpolate ? alpha : 1);
    scene.render();

    statsTimer += frameSeconds;
    if (statsTimer >= STATS_INTERVAL) {
      tickRate = Math.round((loop.tickCount - statsTicks) / statsTimer);
      statsTicks = loop.tickCount;
      statsTimer = 0;
      publishStats();
    }
  });

  updateAutoPause();
  return { world, rng, loop, settings, publishStats };
}
