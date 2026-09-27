import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import type { SceneContext } from "@/scenes/scene";

/** The plain 20×20 ground the demo scenes stand on (the arena builds its own floor). */
export function addDemoGround(ctx: SceneContext): void {
  const ground = ctx.own(MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, ctx.scene));
  const material = ctx.own(new StandardMaterial("ground", ctx.scene));
  material.diffuseColor = new Color3(0.12, 0.13, 0.12);
  material.specularColor = Color3.Black();
  ground.material = material;
}
