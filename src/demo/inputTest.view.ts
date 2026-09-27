import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { GROUND_Y } from "@/core/constants";
import { addDemoGround } from "@/demo/ground.view";
import { inputTestSim } from "@/demo/inputTest";
import type { Action, InputFrame } from "@/input/actions";
import type { SceneContext, SceneDef } from "@/scenes/scene";
import { inputStats } from "@/ui/signals";

// The input test's view: pawn tint, aim ring and move-target pin, and the input overlay.

const STATS_INTERVAL = 0.1;
/** How long a pressed action stays highlighted in the overlay, in seconds (wall clock). */
const FLASH_SECONDS = 0.3;

export const inputTestScene: SceneDef = { ...inputTestSim, setup };

function setup(ctx: SceneContext): void {
  const { world, scene, input } = ctx;
  addDemoGround(ctx);
  const pawn = world.with("pawn").first;
  if (!pawn) throw new Error("input test: no pawn spawned");

  const pawnMesh = ctx.meshOf(pawn);
  if (pawnMesh) {
    const pawnMaterial = ctx.own(new StandardMaterial("pawn", scene));
    pawnMaterial.diffuseColor = new Color3(0.85, 0.55, 0.3);
    pawnMesh.material = pawnMaterial;
  }

  // What the simulation saw on its latest tick (the recorded input during a replay).
  let lastTick: InputFrame | undefined;

  // Markers read state each frame: the aim ring follows the sim's aim, the pin the move target.
  const markerMaterial = (name: string, color: Color3) => {
    const material = ctx.own(new StandardMaterial(name, scene));
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color;
    return material;
  };
  const aimRing = ctx.own(
    MeshBuilder.CreateTorus("aim", { diameter: 0.8, thickness: 0.06 }, scene),
  );
  aimRing.material = markerMaterial("aim", new Color3(0.9, 0.85, 0.6));
  const targetPin = ctx.own(
    MeshBuilder.CreateCylinder("target", { height: 1, diameter: 0.08 }, scene),
  );
  targetPin.material = markerMaterial("target", new Color3(0.4, 0.8, 1));

  ctx.onBeforeRender(() => {
    const aim = lastTick?.aim ?? input.aim;
    aimRing.position.set(aim.x, GROUND_Y + 0.02, aim.z);
    const target = pawn.pawn.target;
    targetPin.setEnabled(!!target);
    if (target) targetPin.position.set(target.x, GROUND_Y + 0.5, target.z);
  });

  // Overlay: what the simulation saw on its latest tick, plus live held actions and press counts.
  let dirty = true;
  let statsTimer = 0;
  const pressCounts: Partial<Record<Action, number>> = {};
  const lastPressedAt: Partial<Record<Action, number>> = {};

  ctx.onTick((tick) => {
    lastTick = tick;
    const now = performance.now() / 1000;
    for (const action of tick.pressed) {
      pressCounts[action] = (pressCounts[action] ?? 0) + 1;
      lastPressedAt[action] = now;
    }
    if (tick.pressed.size || tick.released.size || tick.moveCommand) dirty = true;
  });

  ctx.onDispose(() => {
    inputStats.value = null;
  });

  let lastFrameAt = performance.now() / 1000;
  ctx.onFrame((frame) => {
    if (frame.pressed.size) dirty = true;

    const now = performance.now() / 1000;
    statsTimer += now - lastFrameAt;
    lastFrameAt = now;
    if (!dirty && statsTimer < STATS_INTERVAL) return;
    statsTimer = 0;
    dirty = false;

    inputStats.value = {
      preset: input.preset.label,
      move: lastTick?.move ?? { x: 0, z: 0 },
      moveCommand: lastTick?.moveCommand ?? null,
      aim: lastTick?.aim ?? input.aim,
      held: [...frame.held],
      pressCounts: { ...pressCounts },
      flashing: (Object.keys(lastPressedAt) as Action[]).filter(
        (action) => now - (lastPressedAt[action] ?? 0) < FLASH_SECONDS,
      ),
    };
  });
}
