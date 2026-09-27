import { ArcRotateCamera, type Camera, type Scene, TargetCamera, Vector3 } from "@babylonjs/core";

/**
 * A mouse-driven debug camera (drag to orbit, right-drag to pan, wheel to zoom) that starts at
 * the game camera's pose. It only changes what's rendered: aim and movement keep using the game
 * camera.
 */
export function createFreeCamera(scene: Scene, gameCamera: Camera, canvas: HTMLCanvasElement) {
  let camera: ArcRotateCamera | null = null;

  return {
    get active(): boolean {
      return camera !== null;
    },

    set active(on: boolean) {
      if (on === (camera !== null)) return;
      if (on) {
        const target = gameCamera instanceof TargetCamera ? gameCamera.getTarget() : Vector3.Zero();
        camera = new ArcRotateCamera("freeCamera", 0, 0, 10, target.clone(), scene);
        camera.setPosition(gameCamera.position.clone());
        camera.fov = gameCamera.fov;
        camera.minZ = gameCamera.minZ;
        camera.wheelDeltaPercentage = 0.02;
        camera.panningSensibility = 100;
        camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
        camera.attachControl(canvas, true);
        scene.activeCamera = camera;
      } else {
        scene.activeCamera = gameCamera;
        camera?.dispose();
        camera = null;
      }
    },
  };
}
