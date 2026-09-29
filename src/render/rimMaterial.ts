import {
  Color3,
  type Material,
  MaterialPluginBase,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";

// A fresnel rim light on chosen PBR materials (the player body): an emissive glow along the
// silhouette, strongest where the surface turns away from the camera, so the body separates from
// a dark floor in color and in the value view. It's emissive, so bloom picks it up.

export const RIM = defineTunables("rim", {
  enabled: { value: true },
  /** sRGB. A cool, moonlit edge by default. */
  color: { value: "#9fb6e0", color: true },
  /** Emissive strength at the very edge. */
  strength: { value: 0.35, min: 0, max: 3, step: 0.01 },
  /** How tight the rim hugs the silhouette (higher = thinner). */
  power: { value: 3, min: 0.5, max: 8, step: 0.1 },
});

const color = new Color3();

const definitions = /* wgsl */ `
fn rimLight(normal: vec3f, view: vec3f, rim: vec4f, power: f32) -> vec3f {
  let edge = pow(1.0 - clamp(abs(dot(normal, view)), 0.0, 1.0), power);
  return rim.rgb * rim.a * edge;
}
`;

const apply = /* wgsl */ `
finalEmissive += rimLight(normalW, viewDirectionW, uniforms.rimColor, uniforms.rimPower);
`;

class RimPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "Rim", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "RimPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.WGSL;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "rimColor", size: 4, type: "vec4" },
        { name: "rimPower", size: 1, type: "float" },
      ],
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    Color3.FromHexString(RIM.color).toLinearSpaceToRef(color);
    uniformBuffer.updateFloat4(
      "rimColor",
      color.r,
      color.g,
      color.b,
      RIM.enabled ? RIM.strength : 0,
    );
    uniformBuffer.updateFloat("rimPower", RIM.power);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage) {
    if (shaderType !== "fragment" || shaderLanguage !== ShaderLanguage.WGSL) return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: definitions,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: apply,
    };
  }
}

/** Gives `material` (PBR) the rim light, once. */
export function addRimLight(material: Material): void {
  if (material.pluginManager?.getPlugin("Rim")) return;
  new RimPlugin(material);
}
