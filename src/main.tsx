import { render } from "preact";
import "@/ui/styles/tokens.css";
import "@/ui/styles/global.css";
import { createWorld } from "@/ecs/world";
import { createEngine, createMeshSync, createScene } from "@/render/scene";
import { spinSystem } from "@/systems/spin";
import { SmokeLabel } from "@/ui/SmokeLabel";
import { fps } from "@/ui/signals";

// Throwaway smoke-test scene for step 0.1; replaced by the real game shell in 0.2.

const canvas = document.getElementById("game") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui") as HTMLElement;

const world = createWorld();
world.add({
  transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0.4, y: 0, z: 0 } },
  spin: { speed: 1 },
});

const engine = createEngine(canvas);
const scene = createScene(engine);
const meshSync = createMeshSync(world, scene);

let fpsTimer = 0;
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  spinSystem(world, dt);
  meshSync.sync();
  scene.render();

  fpsTimer += dt;
  if (fpsTimer >= 0.25) {
    fpsTimer = 0;
    fps.value = Math.round(engine.getFps());
  }
});

render(<SmokeLabel />, uiRoot);
