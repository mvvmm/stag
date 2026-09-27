import {
  type Camera,
  Color3,
  Color4,
  type LinesMesh,
  Matrix,
  MeshBuilder,
  type Scene,
  Vector3,
  VertexBuffer,
  type WebGPUEngine,
} from "@babylonjs/core";
import { DEBUG_COLORS, type DebugDraw } from "@/core/debugDraw";

const GRID_HALF = 10;
/** Rendering group drawn after the scene with a cleared depth buffer, so debug lines sit on top. */
const DEBUG_GROUP = 1;

/** A ground grid at 1-unit spacing, skipping the axis lines. */
function createGrid(scene: Scene): LinesMesh {
  const lines: Vector3[][] = [];
  for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
    if (i === 0) continue;
    lines.push([new Vector3(i, 0.01, -GRID_HALF), new Vector3(i, 0.01, GRID_HALF)]);
    lines.push([new Vector3(-GRID_HALF, 0.01, i), new Vector3(GRID_HALF, 0.01, i)]);
  }
  const grid = MeshBuilder.CreateLineSystem("debugGrid", { lines }, scene);
  const { r, g, b } = DEBUG_COLORS.grey;
  grid.color = new Color3(r, g, b);
  grid.isPickable = false;
  grid.setEnabled(false);
  return grid;
}

/**
 * Draws the debug-draw buffer each frame: all segments as one vertex-colored line system (grown
 * as needed, updated in place, drawn on top of the scene) and text as pooled HTML labels. Also
 * draws the `grid` category: a depth-tested ground grid with the world axes.
 */
export function createDebugDrawRenderer(draw: DebugDraw, scene: Scene, engine: WebGPUEngine) {
  let capacity = 0;
  let mesh: LinesMesh | null = null;
  let positions = new Float32Array(0);
  let colors = new Float32Array(0);

  const labelRoot = document.createElement("div");
  labelRoot.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  document.body.append(labelRoot);
  const labels: HTMLDivElement[] = [];

  /** (Re)creates the line mesh with room for `segments` lines. */
  const grow = (segments: number) => {
    capacity = Math.max(256, 2 ** Math.ceil(Math.log2(segments)));
    mesh?.dispose();
    const zero = Vector3.Zero();
    const black = new Color4(0, 0, 0, 0);
    mesh = MeshBuilder.CreateLineSystem(
      "debugDraw",
      {
        lines: Array.from({ length: capacity }, () => [zero, zero]),
        colors: Array.from({ length: capacity }, () => [black, black]),
        updatable: true,
        useVertexAlpha: false,
      },
      scene,
    );
    mesh.renderingGroupId = DEBUG_GROUP;
    mesh.isPickable = false;
    // The bounding box never follows the updated vertices, so never frustum-cull it.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    positions = new Float32Array(capacity * 6);
    colors = new Float32Array(capacity * 8);
  };

  // The grid is static and depth-tested (a separate mesh), unlike on-top debug shapes; it's
  // still toggled by the `grid` category. The axes and labels go through the buffer.
  const grid = createGrid(scene);
  const drawAxes = () => {
    const options = { category: "grid" } as const;
    draw.arrow({ x: 0, z: 0, y: 0.02 }, { x: 2, z: 0, y: 0.02 }, { ...options, color: "red" });
    draw.arrow({ x: 0, z: 0, y: 0.02 }, { x: 0, z: 2, y: 0.02 }, { ...options, color: "blue" });
    draw.line({ x: 0, z: 0, y: 0 }, { x: 0, z: 0, y: 2 }, { ...options, color: "green" });
    draw.text({ x: 2.2, z: 0 }, "+x", { ...options, color: "red" });
    draw.text({ x: 0, z: 2.2 }, "+z", { ...options, color: "blue" });
  };

  const projected = new Vector3();
  const worldPoint = new Vector3();

  const updateLabels = (items: ReturnType<DebugDraw["collect"]>["labels"], camera: Camera) => {
    while (labels.length < items.length) {
      const label = document.createElement("div");
      label.style.cssText =
        "position:absolute;left:0;top:0;font:12px ui-monospace,monospace;white-space:nowrap;" +
        "text-shadow:0 0 3px #000,0 0 2px #000;transform-origin:0 0";
      labelRoot.append(label);
      labels.push(label);
    }
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const viewport = camera.viewport.toGlobal(width, height);
    const transform = scene.getTransformMatrix();
    // Render pixels → CSS pixels.
    const scale = engine.getHardwareScalingLevel();
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] as HTMLDivElement;
      const item = items[i];
      if (!item) {
        label.style.display = "none";
        continue;
      }
      worldPoint.set(item.at.x, item.at.y, item.at.z);
      Vector3.ProjectToRef(worldPoint, Matrix.IdentityReadOnly, transform, viewport, projected);
      if (projected.z < 0 || projected.z > 1) {
        label.style.display = "none";
        continue;
      }
      label.style.display = "";
      label.textContent = item.text;
      const { r, g, b } = item.color;
      label.style.color = `rgb(${r * 255} ${g * 255} ${b * 255})`;
      label.style.transform = `translate(${projected.x * scale + 4}px, ${projected.y * scale - 14}px)`;
    }
  };

  return {
    /** Draws the current buffer. Call each frame after mesh sync, before rendering. */
    update(): void {
      const showGrid = draw.enabled && draw.categories.get("grid") !== false;
      grid.setEnabled(showGrid);
      if (showGrid) drawAxes();
      const { segments, labels: items } = draw.enabled
        ? draw.collect()
        : { segments: [], labels: [] };

      if (segments.length > capacity) grow(segments.length);
      if (mesh) {
        for (let i = 0; i < capacity; i++) {
          const s = segments[i];
          const p = i * 6;
          const c = i * 8;
          if (s) {
            positions.set([s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z], p);
            colors.set([s.color.r, s.color.g, s.color.b, 1, s.color.r, s.color.g, s.color.b, 1], c);
          } else {
            positions.fill(0, p, p + 6); // unused slots collapse to a point
          }
        }
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
        mesh.setEnabled(segments.length > 0);
      }

      const camera = scene.activeCamera;
      if (camera) updateLabels(items, camera);
    },
  };
}
