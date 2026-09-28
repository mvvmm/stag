import { type Color3, PBRMaterial, type Scene } from "@babylonjs/core";

/**
 * A grey-box PBR material: rough, non-metal, with an sRGB `color` (converted to the linear albedo
 * PBR expects, like a glTF base color). What pack assets will use, so lighting tuned on it carries
 * over.
 */
export function greyboxMaterial(
  name: string,
  scene: Scene,
  color: Color3,
  { roughness = 0.9, emissive = 0 }: { roughness?: number; emissive?: number } = {},
): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color.toLinearSpace();
  material.metallic = 0;
  material.roughness = roughness;
  if (emissive > 0) material.emissiveColor = color.toLinearSpace().scale(emissive);
  return material;
}
