import { Color3, type Mesh, MeshBuilder, type Scene, StandardMaterial } from "@babylonjs/core";
import type { World } from "miniplex";
import { lerp, lerpAngle } from "@/core/math";
import type { Entity } from "@/ecs/world";

/**
 * Mirrors ECS entities with a transform into Babylon meshes. Call `sync(alpha)` once per frame;
 * entities with a `prevTransform` are drawn `alpha` of the way from the previous tick to the
 * current one (pass 1 to show the latest tick as-is).
 */
export function createMeshSync(world: World<Entity>, scene: Scene) {
  const meshes = new Map<Entity, Mesh>();
  const renderable = world.with("transform");

  const material = new StandardMaterial("box", scene);
  material.diffuseColor = new Color3(0.5, 0.64, 0.42);

  const addMesh = (entity: Entity) => {
    const mesh = MeshBuilder.CreateBox("box", { width: 0.6, height: 0.6, depth: 1.2 }, scene);
    mesh.material = material;
    meshes.set(entity, mesh);
  };
  for (const entity of renderable) addMesh(entity);
  renderable.onEntityAdded.subscribe(addMesh);
  renderable.onEntityRemoved.subscribe((entity) => {
    meshes.get(entity)?.dispose();
    meshes.delete(entity);
  });

  return {
    /** The mesh mirroring `entity`, if it has one (e.g. for demo tinting). */
    meshOf(entity: Entity): Mesh | undefined {
      return meshes.get(entity);
    },

    sync(alpha: number) {
      for (const entity of renderable) {
        const mesh = meshes.get(entity);
        if (!mesh) continue;
        const { position: p, rotation: r } = entity.transform;
        const prev = entity.prevTransform;
        if (prev && alpha < 1) {
          const pp = prev.position;
          const pr = prev.rotation;
          mesh.position.set(lerp(pp.x, p.x, alpha), lerp(pp.y, p.y, alpha), lerp(pp.z, p.z, alpha));
          mesh.rotation.set(
            lerpAngle(pr.x, r.x, alpha),
            lerpAngle(pr.y, r.y, alpha),
            lerpAngle(pr.z, r.z, alpha),
          );
        } else {
          mesh.position.set(p.x, p.y, p.z);
          mesh.rotation.set(r.x, r.y, r.z);
        }
      }
    },
  };
}
