import { Color3, MeshBuilder } from "@babylonjs/core";
import { greyboxMaterial } from "@/render/materials";
import type { SceneContext } from "@/scenes/scene";

/** The plain 20×20 ground the demo scenes stand on (the arena builds its own floor). */
export function addDemoGround(ctx: SceneContext): void {
  const ground = ctx.own(MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, ctx.scene));
  ground.material = ctx.own(greyboxMaterial("ground", ctx.scene, new Color3(0.2, 0.21, 0.2)));
  ground.receiveShadows = true;
}
