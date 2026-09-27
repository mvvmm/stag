import { render } from "preact";
import "@/ui/styles/tokens.css";
import "@/ui/styles/global.css";
import { startLoopTest } from "@/demo/loopTest";
import { isWebGPUSupported } from "@/render/engine";
import { startShell } from "@/shell";
import { LoopStats } from "@/ui/LoopStats";
import { Unsupported } from "@/ui/Unsupported";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui") as HTMLElement;

async function bootstrap() {
  // Dev-only escape hatch to preview the unsupported screen: ?nowebgpu
  const forceUnsupported =
    import.meta.env.DEV && new URLSearchParams(location.search).has("nowebgpu");
  if (forceUnsupported || !(await isWebGPUSupported())) {
    render(<Unsupported />, uiRoot);
    return;
  }

  // Wall-clock seed for now; seeds become displayable and replayable in 8.5.
  const seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  let shell: Awaited<ReturnType<typeof startShell>>;
  try {
    shell = await startShell(canvas, seed);
  } catch (error) {
    console.error(error);
    render(<Unsupported detail={String(error)} />, uiRoot);
    return;
  }
  console.info(`seed ${seed}`);

  startLoopTest(shell);
  render(<LoopStats />, uiRoot);
}

void bootstrap();
