import { Color3, type Mesh, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import { boxCorners, type ObstacleType, WALL_THICKNESS } from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";
import { createGridMaterial } from "@/render/gridMaterial";
import { createOcclusionFader } from "@/render/occlusion";
import { arenaSim } from "@/scenes/arena";
import type { SceneContext, SceneDef } from "@/scenes/scene";

// The arena's view: gridded floor, grey-box obstacle meshes, the camera following the pawn, and
// obstacles fading while they hide it.

/** Floor beyond the walls, so the void isn't visible when the camera nears an edge. */
const FLOOR_MARGIN = 20;

const OBSTACLE_COLORS: Record<ObstacleType, Color3> = {
  wall: new Color3(0.36, 0.37, 0.39),
  low: new Color3(0.55, 0.56, 0.57),
  block: new Color3(0.3, 0.31, 0.33),
  pillar: new Color3(0.42, 0.39, 0.35),
};

export const arenaScene: SceneDef = { ...arenaSim, setup };

function setup(ctx: SceneContext): void {
  const { world, scene } = ctx;
  const room = world.with("room").first?.room;
  const pawn = world.with("pawn", "transform").first;
  if (!room || !pawn) throw new Error("arena: no room or pawn spawned");

  const floor = ctx.own(
    MeshBuilder.CreateGround(
      "floor",
      {
        width: room.width + (WALL_THICKNESS + FLOOR_MARGIN) * 2,
        height: room.depth + (WALL_THICKNESS + FLOOR_MARGIN) * 2,
      },
      scene,
    ),
  );
  floor.material = ctx.own(createGridMaterial(scene, room.width, room.depth));
  floor.isPickable = false;
  floor.freezeWorldMatrix();

  const materials = new Map<ObstacleType, StandardMaterial>();
  const materialFor = (type: ObstacleType) => {
    let material = materials.get(type);
    if (!material) {
      material = ctx.own(new StandardMaterial(`obstacle-${type}`, scene));
      material.diffuseColor = OBSTACLE_COLORS[type];
      material.specularColor = new Color3(0.04, 0.04, 0.04);
      materials.set(type, material);
    }
    return material;
  };

  const obstacleMeshes: Mesh[] = [];
  const obstacles = [...world.with("obstacle")];
  for (const entity of obstacles) {
    const mesh = ctx.own(obstacleMesh(ctx, entity));
    mesh.material = materialFor(entity.obstacle.type);
    mesh.freezeWorldMatrix();
    ctx.bindMesh(entity, mesh);
    obstacleMeshes.push(mesh);
  }

  const pawnMesh = ctx.meshOf(pawn);
  if (pawnMesh) {
    const pawnMaterial = ctx.own(new StandardMaterial("pawn", scene));
    pawnMaterial.diffuseColor = new Color3(0.85, 0.55, 0.3);
    pawnMesh.material = pawnMaterial;
  }

  // The camera looks at the ground under the pawn's interpolated mesh (the tick state if there's
  // no mesh).
  const focus = () => {
    const p = pawnMesh?.position ?? pawn.transform.position;
    return { x: p.x, y: 0, z: p.z };
  };
  ctx.setCameraTarget(focus);

  const fader = createOcclusionFader(scene, ctx.camera, obstacleMeshes, focus);
  ctx.onBeforeRender(() => fader.update(scene.getEngine().getDeltaTime() / 1000));

  ctx.onFrame(() => {
    if (!debugDraw.enabled) return;
    for (const { obstacle } of obstacles) {
      const shape = obstacle.shape;
      const options = { color: "green", category: "obstacles" } as const;
      if (shape.kind === "circle") debugDraw.circle(shape, shape.r, options);
      else debugDraw.path(boxCorners(shape), { ...options, closed: true });
    }
  });
}

/** A grey-box mesh for an obstacle: a cylinder or a box standing on the ground. */
function obstacleMesh(ctx: SceneContext, entity: Entity & Required<Pick<Entity, "obstacle">>) {
  const { shape, height, type } = entity.obstacle;
  const mesh =
    shape.kind === "circle"
      ? MeshBuilder.CreateCylinder(
          type,
          { height, diameter: shape.r * 2, tessellation: 24 },
          ctx.scene,
        )
      : MeshBuilder.CreateBox(type, { width: shape.w, height, depth: shape.d }, ctx.scene);
  mesh.position.set(shape.x, height / 2, shape.z);
  if (shape.kind === "box") mesh.rotation.y = shape.yaw;
  return mesh;
}
