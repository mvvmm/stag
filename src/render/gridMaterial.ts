import { type Scene, ShaderLanguage, ShaderMaterial, Vector2 } from "@babylonjs/core";

// Grey-box floor: flat dark grey with faint 1 m lines and brighter lines every 5 m, drawn from the
// world position, so it's continuous across meshes and needs no UVs. Outside the room's inner
// area it's darker and has only the 5 m lines. WGSL (Babylon's GridMaterial
// is GLSL-only, which on WebGPU means fetching the GLSL→WGSL converters from a CDN). Unlit and
// throwaway: the 1.5 atmosphere pass replaces it.

const vertexSource = /* wgsl */ `
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
attribute position: vec3f;
varying vWorld: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let world = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vWorld = world.xyz;
  vertexOutputs.position = uniforms.viewProjection * world;
}
`;

const fragmentSource = /* wgsl */ `
uniform halfSize: vec2f;
varying vWorld: vec3f;

// How much of a line of the given spacing covers this pixel (0..1), antialiased by the pixel's
// footprint and faded out once the lines get denser than a few pixels apart.
fn gridLine(p: vec2f, spacing: f32, width: f32) -> f32 {
  let q = p / spacing;
  let footprint = fwidth(q);
  let distance = abs(fract(q - 0.5) - 0.5) / footprint;
  let line = 1.0 - min(min(distance.x, distance.y) - width * 0.5, 1.0);
  let density = max(footprint.x, footprint.y);
  return clamp(line, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.35, density));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let p = fragmentInputs.vWorld.xz;
  let inside = f32(all(abs(p) <= uniforms.halfSize));
  let base = mix(vec3f(0.05, 0.052, 0.05), vec3f(0.105, 0.11, 0.105), inside);
  let minor = gridLine(p, 1.0, 1.0) * inside;
  let major = gridLine(p, 5.0, 1.5) * mix(0.35, 1.0, inside);
  var color = mix(base, vec3f(0.15, 0.16, 0.15), minor);
  color = mix(color, vec3f(0.22, 0.235, 0.22), major);
  fragmentOutputs.color = vec4f(color, 1.0);
}
`;

/** The grid floor material for a room of `width` × `depth` centered on the origin. */
export function createGridMaterial(scene: Scene, width: number, depth: number): ShaderMaterial {
  const material = new ShaderMaterial(
    "grid",
    scene,
    { vertexSource, fragmentSource },
    {
      attributes: ["position"],
      uniforms: ["world", "viewProjection", "halfSize"],
      shaderLanguage: ShaderLanguage.WGSL,
    },
  );
  material.setVector2("halfSize", new Vector2(width / 2, depth / 2));
  return material;
}
