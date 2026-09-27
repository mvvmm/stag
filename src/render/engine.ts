import { WebGPUEngine } from "@babylonjs/core";
import { MAX_PIXEL_RATIO } from "@/core/constants";

/** True when the browser exposes WebGPU and can hand out an adapter. */
export async function isWebGPUSupported(): Promise<boolean> {
  if (!("gpu" in navigator)) return false;
  try {
    return await WebGPUEngine.IsSupportedAsync;
  } catch {
    return false;
  }
}

/** Creates the WebGPU engine, sized to the canvas. Call `fitCanvas` every frame after this. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<WebGPUEngine> {
  // We manage the pixel ratio ourselves; Babylon's adaptToDeviceRatio ignores the cap on DPR changes.
  const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
  await engine.initAsync();
  fitCanvas(engine);
  return engine;
}

/**
 * Matches the drawing buffer to the canvas's CSS size and the device pixel ratio (capped at
 * `MAX_PIXEL_RATIO`, and re-read so moving between displays works). Call at the start of every
 * frame, right before rendering: resizing clears the canvas, so resizing anywhere else (e.g. in a
 * ResizeObserver, which runs after rAF) paints a black frame. It's a no-op when nothing changed.
 */
export function fitCanvas(engine: WebGPUEngine): void {
  const level = 1 / Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  if (engine.getHardwareScalingLevel() !== level) {
    engine.setHardwareScalingLevel(level); // also resizes
  } else {
    engine.resize();
  }
}
