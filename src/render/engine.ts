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

/**
 * Creates the WebGPU engine and keeps it sized to the canvas. Render resolution follows the
 * device pixel ratio, capped at `MAX_PIXEL_RATIO`, and updates when the window changes displays.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<WebGPUEngine> {
  // We manage the pixel ratio ourselves; Babylon's adaptToDeviceRatio ignores the cap on DPR changes.
  const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
  await engine.initAsync();

  const applyPixelRatio = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    engine.setHardwareScalingLevel(1 / ratio); // also resizes
  };

  // matchMedia on the current resolution fires once when it changes, so re-arm on every change.
  let dprQuery: MediaQueryList | undefined;
  const watchPixelRatio = () => {
    dprQuery?.removeEventListener("change", onPixelRatioChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", onPixelRatioChange);
  };
  const onPixelRatioChange = () => {
    applyPixelRatio();
    watchPixelRatio();
  };

  const resizeObserver = new ResizeObserver(() => engine.resize());
  resizeObserver.observe(canvas);
  applyPixelRatio();
  watchPixelRatio();

  engine.onDisposeObservable.addOnce(() => {
    resizeObserver.disconnect();
    dprQuery?.removeEventListener("change", onPixelRatioChange);
  });
  return engine;
}
