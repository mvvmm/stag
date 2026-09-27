import { render } from "preact";
import "@/ui/styles/tokens.css";
import "@/ui/styles/global.css";
import { DEBUG } from "@/debug/enabled";
import { startInputTest } from "@/demo/inputTest";
import { isWebGPUSupported } from "@/render/engine";
import { startShell } from "@/shell";
import { DevOverlay } from "@/ui/DevOverlay";
import { InputStats } from "@/ui/InputStats";
import { Stats } from "@/ui/Stats";
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

  // Wall-clock seed for now; seeds become displayable and replayable in 0.4.1.
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

  startInputTest(shell);
  // The dev tools are a separate chunk that players never download (see debug/enabled.ts).
  if (DEBUG) {
    const { startDevtools } = await import("@/debug/devtools");
    startDevtools(shell);
  }
  shell.start();

  render(
    <>
      <Stats />
      <InputStats />
      <DevOverlay />
    </>,
    uiRoot,
  );
}

void bootstrap();
