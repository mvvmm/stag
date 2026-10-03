import {
  Color3,
  type Material,
  MaterialPluginBase,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";

// The hover highlight on enemies (2.2): a warm glow over the whole body, stronger along its
// silhouette, added to the final color so it shows on lit and unlit materials alike. Per material:
// a body that can be highlighted on its own needs its own material copies. (Babylon's outline
// renderer breaks the WebGPU pipeline with our SSAO prepass, hence a plugin.)

/** sRGB. */
const COLOR = Color3.FromHexString("#e0603f");
/** The glow over the whole body, and the extra along the silhouette. */
const FILL = 0.1;
const EDGE = 0.9;
const POWER = 2.5;

const color = COLOR.toLinearSpace();

const definitions = /* wgsl */ `
fn hoverGlow(normal: vec3f, view: vec3f, glow: vec4f) -> vec3f {
  let edge = pow(1.0 - clamp(abs(dot(normal, view)), 0.0, 1.0), ${POWER.toFixed(2)});
  return glow.rgb * glow.a * (${FILL.toFixed(2)} + ${EDGE.toFixed(2)} * edge);
}
`;

const apply = /* wgsl */ `
finalColor = vec4f(finalColor.rgb + hoverGlow(normalW, viewDirectionW, uniforms.hoverGlow), finalColor.a);
`;

class HighlightPlugin extends MaterialPluginBase {
  /** 0 = off, 1 = full glow. */
  amount = 0;

  constructor(material: Material) {
    super(material, "Highlight", 210, undefined, true, true);
  }

  override getClassName(): string {
    return "HighlightPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.WGSL;
  }

  override getUniforms() {
    return { ubo: [{ name: "hoverGlow", size: 4, type: "vec4" }] };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4("hoverGlow", color.r, color.g, color.b, this.amount);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage) {
    if (shaderType !== "fragment" || shaderLanguage !== ShaderLanguage.WGSL) return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: definitions,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: apply,
    };
  }
}

/** Gives `material` (PBR) the hover highlight, once, and returns a setter for its strength. */
export function addHighlight(material: Material): (amount: number) => void {
  const plugin =
    (material.pluginManager?.getPlugin("Highlight") as HighlightPlugin | null) ??
    new HighlightPlugin(material);
  return (amount) => {
    plugin.amount = amount;
  };
}
