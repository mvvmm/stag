import { Color3, Matrix, type Mesh, MeshBuilder, StandardMaterial, Vector3 } from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import type { Vec2 } from "@/core/math";
import {
  boxCorners,
  type ObstacleShape,
  type ObstacleType,
  WALL_THICKNESS,
} from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";
import { cellCenter, type NavGrid, navGridOf } from "@/nav/grid";
import { createClickMarker } from "@/render/clickMarker";
import { createGridMaterial } from "@/render/gridMaterial";
import { createOcclusionFader } from "@/render/occlusion";
import { arenaSim, gymSim } from "@/scenes/arena";
import type { SceneContext, SceneDef } from "@/scenes/scene";
import type { SceneSim } from "@/scenes/sim";
import { PLAYER } from "@/systems/movementStats";

// The view of every room scene: gridded floor, grey-box obstacle meshes, the player, the click-to-move marker,
// the camera following the player, and obstacles fading while they hide it.

/** The grey-box player: a capsule this tall, with a nose showing where it faces. */
const PLAYER_HEIGHT = 1.2;
const PLAYER_COLOR = new Color3(0.85, 0.55, 0.3);

/** Floor beyond the walls, so the void isn't visible when the camera nears an edge. */
const FLOOR_MARGIN = 20;

const OBSTACLE_COLORS: Record<ObstacleType, Color3> = {
  wall: new Color3(0.36, 0.37, 0.39),
  low: new Color3(0.55, 0.56, 0.57),
  block: new Color3(0.3, 0.31, 0.33),
  pillar: new Color3(0.42, 0.39, 0.35),
};

/** A room scene's sim plus the shared room view. */
export const roomScene = (sim: SceneSim): SceneDef => ({ ...sim, setup });

export const arenaScene = roomScene(arenaSim);
export const gymScene = roomScene(gymSim);

function setup(ctx: SceneContext): void {
  const { world, scene } = ctx;
  const room = world.with("room").first?.room;
  const player = world.with("player", "transform").first;
  if (!room || !player) throw new Error(`${room?.id ?? "room"}: no room or player spawned`);

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

  const playerMesh = ctx.own(playerBody(ctx));
  ctx.bindMesh(player, playerMesh);

  // The camera looks at the ground under the player's interpolated mesh.
  const focus = () => ({ x: playerMesh.position.x, y: 0, z: playerMesh.position.z });
  ctx.setCameraTarget(focus);

  const fader = createOcclusionFader(scene, ctx.camera, obstacleMeshes, focus);
  const marker = createClickMarker(scene);
  ctx.onDispose(() => marker.dispose());
  let orders = player.player.orders;
  ctx.onBeforeRender(() => {
    const seconds = scene.getEngine().getDeltaTime() / 1000;
    fader.update(seconds);
    // A new click: pop the marker where its path ends (or where the player already stands).
    if (player.player.orders !== orders) {
      orders = player.player.orders;
      marker.show(player.player.order?.goal ?? player.transform.position);
    }
    marker.update(seconds);
  });

  ctx.onFrame(() => {
    if (!debugDraw.enabled) return;
    for (const { obstacle } of obstacles) {
      const shape = obstacle.shape;
      const options = { color: "green", category: "obstacles" } as const;
      if (shape.kind === "circle") debugDraw.circle(shape, shape.r, options);
      else debugDraw.path(boxCorners(shape), { ...options, closed: true });
    }
    const nav = navGridOf(world, PLAYER.radius);
    if (nav) drawNavGrid(nav);
  });
}

/** The player's grey-box body: a capsule standing on its origin, and a nose pointing along +Z. */
function playerBody(ctx: SceneContext): Mesh {
  const radius = PLAYER.radius;
  const body = MeshBuilder.CreateCapsule(
    "player",
    { radius, height: PLAYER_HEIGHT, tessellation: 16 },
    ctx.scene,
  );
  body.bakeTransformIntoVertices(Matrix.Translation(0, PLAYER_HEIGHT / 2, 0));
  const material = ctx.own(new StandardMaterial("player", ctx.scene));
  material.diffuseColor = PLAYER_COLOR;
  material.specularColor = new Color3(0.08, 0.08, 0.08);
  body.material = material;

  const nose = ctx.own(
    MeshBuilder.CreateBox("playerNose", { width: 0.16, height: 0.16, depth: 0.3 }, ctx.scene),
  );
  nose.parent = body;
  nose.position = new Vector3(0, PLAYER_HEIGHT * 0.7, radius + 0.08);
  const noseMaterial = ctx.own(new StandardMaterial("playerNose", ctx.scene));
  noseMaterial.diffuseColor = PLAYER_COLOR.scale(0.45);
  nose.material = noseMaterial;
  nose.isPickable = false;
  return body;
}

/** Cache of the walkable area's edge for the `navgrid` debug draw, per grid. */
const edgeCells = new WeakMap<NavGrid, Vec2[]>();

/** The grown obstacle outlines and the blocked cells along the walkable area's edge. */
function drawNavGrid(nav: NavGrid): void {
  const options = { color: "cyan", category: "navgrid" } as const;
  for (const shape of nav.shapes)
    debugDraw.path(grownOutline(shape, nav.pad), { ...options, closed: true });

  let cells = edgeCells.get(nav);
  if (!cells) {
    cells = [];
    const { cols, rows, blocked } = nav;
    for (let index = 0; index < cols * rows; index++) {
      if (!blocked[index]) continue;
      const col = index % cols;
      const row = (index - col) / cols;
      const free = (c: number, r: number) =>
        c >= 0 && c < cols && r >= 0 && r < rows && !blocked[r * cols + c];
      if (free(col + 1, row) || free(col - 1, row) || free(col, row + 1) || free(col, row - 1)) {
        cells.push(cellCenter(nav, index));
      }
    }
    edgeCells.set(nav, cells);
  }
  const s = nav.cell * 0.3;
  const grey = { color: "grey", category: "navgrid" } as const;
  for (const c of cells) {
    debugDraw.line({ x: c.x - s, z: c.z - s }, { x: c.x + s, z: c.z + s }, grey);
    debugDraw.line({ x: c.x - s, z: c.z + s }, { x: c.x + s, z: c.z - s }, grey);
  }
}

/** A shape grown by `pad`: a bigger circle, or a box with rounded corners. */
function grownOutline(shape: ObstacleShape, pad: number): Vec2[] {
  const points: Vec2[] = [];
  const arc = (cx: number, cz: number, r: number, from: number, to: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps;
      points.push({ x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r });
    }
  };
  if (shape.kind === "circle") {
    arc(shape.x, shape.z, shape.r + pad, 0, Math.PI * 2, 32);
    return points;
  }
  // Each corner's quarter circle, in the box's frame, then turned like the box.
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  const corners: [number, number][] = [
    [hw, hd],
    [-hw, hd],
    [-hw, -hd],
    [hw, -hd],
  ];
  corners.forEach(([x, z], i) => {
    const start = (i * Math.PI) / 2;
    arc(x, z, pad, start, start + Math.PI / 2, 6);
  });
  const cos = Math.cos(shape.yaw);
  const sin = Math.sin(shape.yaw);
  // Same rotation as `rotateByYaw` (left-handed, like Babylon's rotation.y).
  return points.map((p) => ({
    x: shape.x + p.x * cos + p.z * sin,
    z: shape.z - p.x * sin + p.z * cos,
  }));
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
