import {
  type Material,
  MaterialPluginBase,
  PBRMaterial,
  RegisterMaterialPlugin,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";
import type { HeightFog } from "@/render/fogMath";

// Height fog on every PBR material: fog pooling along the floor and thinning upward, on top of
// Babylon's exp2 distance fog and in the same color. The WGSL does per pixel what `heightFogDepth`
// in `fogMath.ts` does (tested there). It only runs where Babylon's own fog does (the `FOG`
// define: scene fog on and the mesh's `applyFog`), so turning scene fog off turns it off too.

/** The live height fog settings, written by the atmosphere rig every frame. */
export const heightFog: HeightFog = { density: 0, base: 0, falloff: 1 };

const definitions = /* wgsl */ `
#ifdef FOG
// Optical depth of the height fog between two points (see heightFogDepth in fogMath.ts).
fn heightFogDepth(eye: vec3f, point: vec3f, fog: vec4f) -> f32 {
  let density = fog.x;
  let base = fog.y;
  let falloff = fog.z;
  let len = length(point - eye);
  let dy = point.y - eye.y;
  if (abs(dy) < 1e-4) {
    let y = (eye.y + point.y) * 0.5;
    return density * exp(-max(y - base, 0.0) / falloff) * len;
  }
  let lo = min(eye.y, point.y);
  let hi = max(eye.y, point.y);
  let below = max(0.0, min(hi, base) - lo);
  let above = falloff * (exp(-(max(lo, base) - base) / falloff) - exp(-(max(hi, base) - base) / falloff));
  return density * len / abs(dy) * (below + above);
}
#endif
`;

const apply = /* wgsl */ `
#ifdef FOG
{
  let heightFogDepthHere = heightFogDepth(scene.vEyePosition.xyz, fragmentInputs.vPositionW, uniforms.heightFog);
  let heightFogAmount = 1.0 - exp(-heightFogDepthHere);
  finalColor = vec4f(mix(finalColor.rgb, uniforms.vFogColor, heightFogAmount), finalColor.a);
}
#endif
`;

class HeightFogPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "HeightFog", 300, undefined, true, true);
  }

  override getClassName(): string {
    return "HeightFogPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.WGSL;
  }

  override getUniforms() {
    return { ubo: [{ name: "heightFog", size: 4, type: "vec4" }] };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4(
      "heightFog",
      heightFog.density,
      heightFog.base,
      Math.max(heightFog.falloff, 1e-3),
      0,
    );
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage) {
    if (shaderType !== "fragment" || shaderLanguage !== ShaderLanguage.WGSL) return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: definitions,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: apply,
    };
  }
}

let registered = false;

/** Adds height fog to every PBR material created from now on. Call once, before building any. */
export function registerHeightFog(): void {
  if (registered) return;
  registered = true;
  RegisterMaterialPlugin("HeightFog", (material) =>
    material instanceof PBRMaterial ? new HeightFogPlugin(material) : null,
  );
}
