import {
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  type Mesh,
  MeshBuilder,
  Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import type { World } from "miniplex";
import type { Entity } from "@/ecs/world";

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(canvas, true);
  window.addEventListener("resize", () => engine.resize());
  return engine;
}

export function createScene(engine: Engine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.04, 1);

  const camera = new UniversalCamera("camera", new Vector3(0, 4, -6), scene);
  camera.setTarget(Vector3.Zero());

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.3;
  const sun = new DirectionalLight("sun", new Vector3(-1, -2, 1), scene);
  sun.intensity = 0.9;

  return scene;
}

/** Mirrors ECS entities with a transform into Babylon meshes. Call `sync()` once per frame. */
export function createMeshSync(world: World<Entity>, scene: Scene) {
  const meshes = new Map<Entity, Mesh>();
  const renderable = world.with("transform");

  renderable.onEntityAdded.subscribe((entity) => {
    meshes.set(entity, MeshBuilder.CreateBox("box", { size: 1.5 }, scene));
  });
  renderable.onEntityRemoved.subscribe((entity) => {
    meshes.get(entity)?.dispose();
    meshes.delete(entity);
  });

  return {
    sync() {
      for (const entity of renderable) {
        const mesh = meshes.get(entity);
        if (!mesh) continue;
        const { position, rotation } = entity.transform;
        mesh.position.set(position.x, position.y, position.z);
        mesh.rotation.set(rotation.x, rotation.y, rotation.z);
      }
    },
  };
}
