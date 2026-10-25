import { Color3, Mesh, type Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import type { Vec2 } from "@/core/math";
import type { Area } from "@/data/abilities";

// Flat grey-box meshes for an ability's areas (`data/abilities.ts` `Area`), shared by the normal
// cast's indicator and the cast flash: a translucent fill with a solid outline, on the ground.
// Each is built in the area's own frame (+z along the aim, the origin at the caster, or at a
// circle's center), so `placeArea` only moves and turns it.

/** Above the floor, under the range ring (0.035). */
const FILL_Y = 0.025;
const LINE_Y = 0.03;

/** The area's outline in its own frame: a convex polygon. */
export function areaOutline(area: Area): Vec2[] {
  switch (area.kind) {
    case "circle": {
      const points: Vec2[] = [];
      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        points.push({ x: Math.sin(angle) * area.radius, z: Math.cos(angle) * area.radius });
      }
      return points;
    }
    case "line":
      return [
        { x: -area.halfWidth, z: 0 },
        { x: area.halfWidth, z: 0 },
        { x: area.halfWidth, z: area.length },
        { x: -area.halfWidth, z: area.length },
      ];
    case "cone": {
      const half = Math.min(area.halfAngle, Math.PI);
      const steps = Math.max(8, Math.ceil((half * 2) / (Math.PI / 48)));
      const points: Vec2[] = [{ x: 0, z: 0 }];
      for (let i = 0; i <= steps; i++) {
        const angle = -half + (half * 2 * i) / steps;
        points.push({ x: Math.sin(angle) * area.range, z: Math.cos(angle) * area.range });
      }
      return points;
    }
  }
}

/** A key that changes whenever the area's geometry does (its numbers are tunables). */
export const areaKey = (area: Area): string => JSON.stringify(area);

/** An unlit flat material in sRGB `color`. */
export function flatMaterial(name: string, scene: Scene, color: string, alpha: number) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString(color).toLinearSpace();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.alpha = alpha;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  return material;
}

/**
 * The area's mesh: the fill (the returned mesh) with the outline, `lineWidth` m wide inside the
 * edge, as its child. Disposing it disposes both; the materials are the caller's.
 */
export function buildAreaMesh(
  name: string,
  scene: Scene,
  area: Area,
  materials: { fill: StandardMaterial; line: StandardMaterial },
  lineWidth: number,
): Mesh {
  const points = areaOutline(area);
  const fill = new Mesh(`${name}Fill`, scene);
  fanGeometry(points).applyToMesh(fill);
  fill.material = materials.fill;
  fill.isPickable = false;
  const line = new Mesh(`${name}Line`, scene);
  outlineGeometry(points, lineWidth).applyToMesh(line);
  line.material = materials.line;
  line.isPickable = false;
  line.parent = fill;
  return fill;
}

/**
 * Puts an area's mesh where the cast would land it: a circle at `point` (or on the caster), a line
 * or cone from the caster along `dir` (a unit vector).
 */
export function placeArea(mesh: Mesh, area: Area, caster: Vec2, dir: Vec2, point: Vec2): void {
  const at = area.kind === "circle" && area.at === "point" ? point : caster;
  mesh.position.set(at.x, 0, at.z);
  // Babylon's rotation.y turns +z toward (sin, cos), as the sim's facing does.
  mesh.rotation.y = area.kind === "circle" ? 0 : Math.atan2(dir.x, dir.z);
}

/** A triangle fan from the polygon's centroid (it's convex). */
function fanGeometry(points: readonly Vec2[]): VertexData {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x / points.length;
    cz += p.z / points.length;
  }
  const positions = [cx, FILL_Y, cz];
  const indices: number[] = [];
  points.forEach((p, i) => {
    positions.push(p.x, FILL_Y, p.z);
    indices.push(0, 1 + i, 1 + ((i + 1) % points.length));
  });
  return vertexData(positions, indices);
}

/** One quad per edge, `width` inward from it (convex: inward is toward the centroid). */
function outlineGeometry(points: readonly Vec2[], width: number): VertexData {
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x / points.length;
    cz += p.z / points.length;
  }
  const positions: number[] = [];
  const indices: number[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as Vec2;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const length = Math.hypot(ex, ez);
    if (length < 1e-6) return;
    let nx = -ez / length;
    let nz = ex / length;
    if (nx * (cx - a.x) + nz * (cz - a.z) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const base = positions.length / 3;
    positions.push(a.x, LINE_Y, a.z, b.x, LINE_Y, b.z);
    positions.push(b.x + nx * width, LINE_Y, b.z + nz * width);
    positions.push(a.x + nx * width, LINE_Y, a.z + nz * width);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return vertexData(positions, indices);
}

function vertexData(positions: number[], indices: number[]): VertexData {
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  return data;
}
