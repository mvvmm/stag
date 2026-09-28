import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { GROUND_Y } from "@/core/constants";
import { addDemoGround } from "@/demo/ground.view";
import { inputTestSim } from "@/demo/inputTest";
import type { InputFrame } from "@/input/actions";
import type { SceneContext, SceneDef } from "@/scenes/scene";

// The input test's view: pawn tint, aim ring and move-target pin. (The input overlay is a dev
// tool now, in every scene: `debug/inputOverlay.ts`.)

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

  ctx.onTick((tick) => {
    lastTick = tick;
  });

  ctx.onBeforeRender(() => {
    const aim = lastTick?.aim ?? input.aim;
    aimRing.position.set(aim.x, GROUND_Y + 0.02, aim.z);
    const target = pawn.pawn.target;
    targetPin.setEnabled(!!target);
    if (target) targetPin.position.set(target.x, GROUND_Y + 0.5, target.z);
  });
}
