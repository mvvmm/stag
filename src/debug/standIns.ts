import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";
import type { Shell } from "@/shell";

// Stand-in threats: view-only props dropped around the player's spawn in room scenes, to judge how
// future telegraphs and enemies read against the dark and the fog. A red-orange ground circle and
// cone (flat, emissive, the rough danger language of 3.2) and a dark enemy silhouette. They're
// meshes, never entities: nothing in the simulation sees them. Rebuilt on every load while on.

const DANGER = new Color3(1, 0.32, 0.12);
/** Where they stand relative to the player's spawn (meters). */
const CIRCLE = { x: 3.5, z: 1.5, r: 1.6 };
const CONE = { x: -3.5, z: 1, length: 4.5, halfAngle: Math.PI / 6, yaw: Math.PI / 4 };
const ENEMY = { x: 1.5, z: 4 };

/** A flat fan (cone telegraph) from the origin along +Z, lying on the ground. */
function fan(scene: Scene, length: number, halfAngle: number): Mesh {
  const segments = 24;
  const positions = [0, 0, 0];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = -halfAngle + (2 * halfAngle * i) / segments;
    positions.push(Math.sin(angle) * length, 0, Math.cos(angle) * length);
    if (i > 0) indices.push(0, i, i + 1);
  }
  const cone = new Mesh("standInCone", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(cone);
  return cone;
}

export function createStandIns(shell: Shell) {
  let meshes: Mesh[] = [];
  let materials: (PBRMaterial | StandardMaterial)[] = [];
  let on = false;

  const clear = () => {
    for (const mesh of meshes) mesh.dispose();
    for (const material of materials) material.dispose();
    meshes = [];
    materials = [];
  };

  const build = () => {
    clear();
    const player = shell.world.with("player", "transform").first;
    if (!on || !player || !shell.world.with("room").first) return;
    const { scene } = shell;
    const at = player.transform.position;

    const danger = new StandardMaterial("standInDanger", scene);
    danger.disableLighting = true;
    danger.emissiveColor = DANGER;
    danger.alpha = 0.55;
    danger.backFaceCulling = false;
    danger.fogEnabled = false;
    materials.push(danger);

    const circle = MeshBuilder.CreateDisc(
      "standInCircle",
      { radius: CIRCLE.r, tessellation: 48 },
      scene,
    );
    circle.rotation.x = Math.PI / 2;
    circle.position.set(at.x + CIRCLE.x, 0.03, at.z + CIRCLE.z);
    const cone = fan(scene, CONE.length, CONE.halfAngle);
    cone.position.set(at.x + CONE.x, 0.03, at.z + CONE.z);
    cone.rotation.y = CONE.yaw;
    for (const mesh of [circle, cone]) {
      mesh.material = danger;
      mesh.isPickable = false;
      meshes.push(mesh);
    }

    // A dark hunched silhouette with glowing eyes, taller than the player.
    const body = new PBRMaterial("standInEnemy", scene);
    body.albedoColor = new Color3(0.02, 0.02, 0.025);
    body.metallic = 0;
    body.roughness = 0.8;
    materials.push(body);
    const enemy = MeshBuilder.CreateCapsule("standInEnemy", { radius: 0.55, height: 2 }, scene);
    enemy.position.set(at.x + ENEMY.x, 1, at.z + ENEMY.z);
    enemy.material = body;
    enemy.isPickable = false;
    meshes.push(enemy);
    const eyes = new StandardMaterial("standInEyes", scene);
    eyes.disableLighting = true;
    eyes.emissiveColor = new Color3(1, 0.25, 0.1);
    materials.push(eyes);
    for (const side of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere("standInEye", { diameter: 0.12 }, scene);
      eye.parent = enemy;
      eye.position.set(side * 0.16, 0.55, -0.5);
      eye.material = eyes;
      eye.isPickable = false;
      meshes.push(eye);
    }
  };

  shell.onLoad(build);

  return {
    get on(): boolean {
      return on;
    },
    set on(value: boolean) {
      on = value;
      build();
    },
  };
}
