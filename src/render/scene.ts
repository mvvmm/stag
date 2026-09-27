import {
  type AbstractEngine,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";

/** Scene, angled top-down camera, lights and a ground plane. The real arena comes in 1.1. */
export function createScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.04, 1);

  const camera = new UniversalCamera("camera", new Vector3(0, 14, -11), scene);
  camera.setTarget(Vector3.Zero());

  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.35;
  const sun = new DirectionalLight("sun", new Vector3(-1, -2, 1), scene);
  sun.intensity = 0.9;

  const ground = MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);
  const groundMaterial = new StandardMaterial("ground", scene);
  groundMaterial.diffuseColor = new Color3(0.12, 0.13, 0.12);
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;

  return scene;
}
