import {
  Color3,
  type Material,
  MaterialPluginBase,
  PBRMaterial,
  type Scene,
  ShaderLanguage,
  type UniformBuffer,
} from "@babylonjs/core";
import { defineTunables } from "@/core/tuning";

// The grey-box floor: a lit, rough PBR surface with a little low-frequency, stone-like variation
// and faint 1 m / 5 m grid lines (so distances still read while tuning movement), drawn from the
// world position by a WGSL plugin, so it needs no UVs or textures. Past the room's edges it
// darkens into the void and has no lines.

export const FLOOR = defineTunables("floor", {
  /** How strong the grid lines are (0 = none, 1 = as bright as the old unlit grid). */
  gridStrength: { value: 0.35, min: 0, max: 1, step: 0.01 },
  /** How much the albedo varies (0 = flat). */
  noiseStrength: { value: 0.35, min: 0, max: 1, step: 0.01 },
  /** How dark the floor gets past the walls (0 = black, 1 = like inside). */
  outside: { value: 0.25, min: 0, max: 1, step: 0.01 },
  /** Over how many meters past the room's edge it darkens. */
  outsideFade: { value: 3, min: 0.1, max: 15, step: 0.1 },
  /** Floor color (sRGB). */
  color: { value: "#383a3a", color: true },
});

/** Forces the full-strength grid (the "atmosphere off" view); written by the atmosphere rig. */
export const floorOverride = { fullGrid: false };

const definitions = /* wgsl */ `
// How much of a line of the given spacing covers this pixel (0..1), antialiased by the pixel's
// footprint and faded out once the lines get denser than a few pixels apart.
fn floorGridLine(p: vec2f, spacing: f32, width: f32) -> f32 {
  let q = p / spacing;
  let footprint = fwidth(q);
  let distance = abs(fract(q - 0.5) - 0.5) / footprint;
  let line = 1.0 - min(min(distance.x, distance.y) - width * 0.5, 1.0);
  let density = max(footprint.x, footprint.y);
  return clamp(line, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.35, density));
}

fn floorHash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise in 0..1.
fn floorNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = floorHash(i);
  let b = floorHash(i + vec2f(1.0, 0.0));
  let c = floorHash(i + vec2f(0.0, 1.0));
  let d = floorHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// Right after the albedo is known, in main (fwidth needs uniform control flow).
const apply = /* wgsl */ `
{
  let p = fragmentInputs.vPositionW.xz;
  let halfSize = uniforms.floorShape.xy;
  let outsideDistance = length(max(abs(p) - halfSize, vec2f(0.0)));
  let inside = f32(outsideDistance <= 0.0);
  let variation = floorNoise(p * 0.3) * 0.6 + floorNoise(p * 1.7 + 17.0) * 0.4;
  var albedo = surfaceAlbedo * (1.0 + uniforms.floorLook.y * (variation - 0.5) * 1.2);
  let minor = floorGridLine(p, 1.0, 1.0) * inside;
  let major = floorGridLine(p, 5.0, 1.5) * inside;
  albedo = albedo * (1.0 + uniforms.floorLook.x * max(minor * 0.45, major * 1.1));
  let fade = smoothstep(0.0, uniforms.floorShape.w, outsideDistance);
  surfaceAlbedo = albedo * mix(1.0, uniforms.floorShape.z, fade);
}
`;

class FloorPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private readonly halfWidth: number,
    private readonly halfDepth: number,
  ) {
    super(material, "Floor", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "FloorPlugin";
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.WGSL;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: "floorShape", size: 4, type: "vec4" },
        { name: "floorLook", size: 4, type: "vec4" },
      ],
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const full = floorOverride.fullGrid;
    uniformBuffer.updateFloat4(
      "floorShape",
      this.halfWidth,
      this.halfDepth,
      full ? 1 : FLOOR.outside,
      FLOOR.outsideFade,
    );
    uniformBuffer.updateFloat4(
      "floorLook",
      full ? 1 : FLOOR.gridStrength,
      full ? 0 : FLOOR.noiseStrength,
      0,
      0,
    );
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage) {
    if (shaderType !== "fragment" || shaderLanguage !== ShaderLanguage.WGSL) return null;
    return { CUSTOM_FRAGMENT_DEFINITIONS: definitions, CUSTOM_FRAGMENT_UPDATE_ALPHA: apply };
  }
}

/** The floor material for a room of `width` × `depth` centered on the origin. */
export function createFloorMaterial(scene: Scene, width: number, depth: number): PBRMaterial {
  const material = new PBRMaterial("floor", scene);
  material.metallic = 0;
  material.roughness = 0.92;
  new FloorPlugin(material, width / 2, depth / 2);
  // The color is a material property; the plugin's uniforms are read on every bind anyway.
  let applied = "";
  const syncColor = () => {
    if (applied === FLOOR.color) return;
    applied = FLOOR.color;
    material.albedoColor = Color3.FromHexString(applied).toLinearSpace();
  };
  syncColor();
  material.onBindObservable.add(syncColor);
  return material;
}
