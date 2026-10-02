import { render } from "preact";
import "@/ui/styles/tokens.css";
import "@/ui/styles/global.css";
import { DEBUG } from "@/debug/enabled";
import { isWebGPUSupported } from "@/render/engine";
import { scenes } from "@/scenes";
import { randomSeed, startShell } from "@/shell";
import { InputStats } from "@/ui/InputStats";
import { Notice } from "@/ui/Notice";
import { PauseMenu } from "@/ui/PauseMenu";
import { ReplayBadge } from "@/ui/ReplayBadge";
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

  let shell: Awaited<ReturnType<typeof startShell>>;
  try {
    shell = await startShell(canvas);
  } catch (error) {
    console.error(error);
    render(<Unsupported detail={String(error)} />, uiRoot);
    return;
  }

  // Players always start the default scene with a fresh seed. The dev tools may pick another
  // scene or seed (`?scene=`, `?seed=`, the last scene used).
  let startup = { def: scenes.default, seed: randomSeed() };
  // The dev tools are a separate chunk that players never download (see debug/enabled.ts).
  if (DEBUG) {
    const { startDevtools } = await import("@/debug/devtools");
    startup = startDevtools(shell).startup(startup.seed);
  }
  shell.load(startup.def, startup.seed);
  shell.start();

  render(
    <>
      <Stats />
      <InputStats />
      <ReplayBadge />
      <Notice />
      <PauseMenu />
    </>,
    uiRoot,
  );
}

void bootstrap();
