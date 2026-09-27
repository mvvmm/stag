import {
  type AbstractEngine,
  type Camera,
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
import { defineTunables } from "@/core/tuning";

/** The game camera. The real follow camera comes in 1.4. */
export const CAMERA = defineTunables("camera", {
  /** Angle above the ground, in degrees (90 = straight down). */
  pitch: { value: 52, min: 20, max: 89, step: 1 },
  /** Distance from the target. */
  distance: { value: 17.8, min: 5, max: 50, step: 0.1 },
  /** Vertical field of view, in degrees. */
  fov: { value: 46, min: 15, max: 100, step: 1 },
});

/** Places the game camera from the `camera` tunables. Call every frame, before aiming. */
export function updateCamera(camera: Camera): void {
  const pitch = (CAMERA.pitch * Math.PI) / 180;
  camera.position.set(0, Math.sin(pitch) * CAMERA.distance, -Math.cos(pitch) * CAMERA.distance);
  camera.fov = (CAMERA.fov * Math.PI) / 180;
  if (camera instanceof UniversalCamera) camera.setTarget(Vector3.Zero());
}

/** Scene, angled top-down camera, lights and a ground plane. The real arena comes in 1.1. */
export function createScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.04, 1);

  const camera = new UniversalCamera("camera", Vector3.Zero(), scene);
  updateCamera(camera);

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
