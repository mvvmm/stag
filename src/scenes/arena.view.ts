import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  type PBRMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { footprintCircles, halfSpine } from "@/collision/body";
import { debugDraw } from "@/core/debugDraw";
import type { Vec2 } from "@/core/math";
import { abilityById } from "@/data/abilities";
import {
  boxCorners,
  type ObstacleShape,
  type ObstacleType,
  WALL_THICKNESS,
} from "@/data/rooms/room";
import type { Entity } from "@/ecs/world";
import { type NavGraph, navGraphOf } from "@/nav/graph";
import { bodyView } from "@/render/bodyView";
import { ATTACK_MARKER, createClickMarker } from "@/render/clickMarker";
import { createDummyViews } from "@/render/dummies";
import { createFloorMaterial } from "@/render/floorMaterial";
import { greyboxMaterial } from "@/render/materials";
import { createOcclusionFader } from "@/render/occlusion";
import { createRangeRing } from "@/render/rangeRing";
import { createTiger } from "@/render/tiger";
import { arenaSim, gymSim, yardSim } from "@/scenes/arena";
import type { SceneContext, SceneDef } from "@/scenes/scene";
import type { SceneSim } from "@/scenes/sim";
import { PLAYER } from "@/systems/movementStats";

// The view of every room scene: gridded floor, grey-box obstacle meshes, the player, the training
// dummies, the click-to-move marker, the camera following the player within the room, obstacles
// fading while they hide it, and what the atmosphere needs (shadow casters and receivers, the
// player light's target).

/** The grey-box player: a capsule this tall, with a nose showing where it faces. */
const PLAYER_HEIGHT = 1.2;
const PLAYER_COLOR = new Color3(0.85, 0.55, 0.3);

/** How much the player glows on its own, so it reads even in the dark and in the value view. */
const PLAYER_GLOW = 0.12;

/** Floor beyond the walls, so the void isn't visible when the camera nears an edge. */
const FLOOR_MARGIN = 20;

/** sRGB. */
const OBSTACLE_COLORS: Record<ObstacleType, Color3> = {
  wall: new Color3(0.32, 0.33, 0.35),
  low: new Color3(0.48, 0.49, 0.5),
  block: new Color3(0.27, 0.28, 0.3),
  pillar: new Color3(0.38, 0.35, 0.31),
};

/** A room scene's sim plus the shared room view. */
export const roomScene = (sim: SceneSim): SceneDef => ({ ...sim, setup });

export const arenaScene = roomScene(arenaSim);
export const gymScene = roomScene(gymSim);
export const yardScene = roomScene(yardSim);

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
  floor.material = ctx.own(createFloorMaterial(scene, room.width, room.depth));
  floor.isPickable = false;
  floor.receiveShadows = true;
  floor.freezeWorldMatrix();

  const materials = new Map<ObstacleType, PBRMaterial>();
  const materialFor = (type: ObstacleType) => {
    let material = materials.get(type);
    if (!material) {
      material = ctx.own(greyboxMaterial(`obstacle-${type}`, scene, OBSTACLE_COLORS[type]));
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
    mesh.receiveShadows = true;
    ctx.bindMesh(entity, mesh);
    obstacleMeshes.push(mesh);
  }

  // The player's body: the tiger (1.6), or the grey-box capsule (the pane's "hitboxes", or
  // if the model didn't load). The capsule hangs under the tiger's root, so either one follows it.
  const tiger = createTiger(scene);
  const capsule = ctx.own(playerBody(ctx));
  ctx.onTunableChange((id) => {
    if (id === null || id === "player.radius") {
      const nose = capsule.getChildMeshes()[0] as Mesh | undefined;
      if (nose) shapePlayerBody(capsule, nose);
    }
  });
  const playerMesh = tiger ? tiger.root : capsule;
  if (tiger) {
    ctx.onDispose(() => {
      // The capsule is owned (and disposed) on its own.
      capsule.parent = null;
      tiger.dispose();
    });
    capsule.parent = tiger.root;
    ctx.onTick((input) => tiger.tick(player, input));
  }
  const showBody = () => {
    const useCapsule = !tiger || bodyView.hitboxes;
    capsule.setEnabled(useCapsule);
    for (const node of tiger?.root.getChildren() ?? []) {
      if (node !== capsule) node.setEnabled(!useCapsule);
    }
  };
  showBody();
  ctx.bindMesh(player, playerMesh);
  const dummies = createDummyViews(ctx);
  ctx.setShadowCasters([...obstacleMeshes, playerMesh, ...dummies]);

  // The camera looks at the ground under the player's interpolated mesh.
  const focus = () => ({ x: playerMesh.position.x, y: 0, z: playerMesh.position.z });
  ctx.setCameraTarget(focus);
  // The player light lights the world around the player, not the capsule (blown out that close);
  // the tiger is low enough under it to take its warm light.
  ctx.setLightTarget(focus, { exclude: [capsule] });
  // The room is centered on the origin; the camera's look-at point stays inside it.
  ctx.setCameraBounds({
    minX: -room.width / 2,
    maxX: room.width / 2,
    minZ: -room.depth / 2,
    maxZ: room.depth / 2,
  });

  const fader = createOcclusionFader(scene, ctx.camera, obstacleMeshes, focus);
  const marker = createClickMarker(ctx.overlay);
  ctx.onDispose(() => marker.dispose());
  // An attack move's marker is red, with a chevron pointing at the enemy it picked (if it did).
  const attackMarker = createClickMarker(ctx.overlay, ATTACK_MARKER);
  ctx.onDispose(() => attackMarker.dispose());
  // The left click that places an armed attack move (seen from the tick it lands on).
  let armed = !!player.player.attackMove?.armed;
  ctx.onTick((input) => {
    if (armed && input.pressed.has("confirm")) {
      const uid = player.caster?.target ?? null;
      const target =
        uid === null ? null : world.with("uid", "transform").entities.find((e) => e.uid === uid);
      const mesh = target ? ctx.meshOf(target) : undefined;
      attackMarker.show(
        input.aim,
        target ? () => mesh?.position ?? target.transform.position : null,
      );
    }
    armed = !!player.player.attackMove?.armed;
  });
  // While an attack move is armed (S, until the left click places it): the auto attack's
  // reach, from the body's movement circle like the range itself.
  const reach = createRangeRing(ctx.overlay);
  ctx.onDispose(() => reach.dispose());
  const reachRadius = () => {
    const slot = player.caster?.slots.primary;
    const def = slot && abilityById(slot.ability);
    return PLAYER.radius + (def ? def.stats(player).range : 0);
  };
  let orders = player.player.orders;
  ctx.onBeforeRender(() => {
    showBody();
    tiger?.update(ctx.viewTime());
    const seconds = scene.getEngine().getDeltaTime() / 1000;
    fader.update(seconds);
    // A new click: pop the marker where its path ends (or where the player already stands).
    if (player.player.orders !== orders) {
      orders = player.player.orders;
      marker.show(player.player.order?.goal ?? player.transform.position);
    }
    marker.update(seconds);
    attackMarker.update(seconds);
    reach.show(player.player.attackMove?.armed ? playerMesh.position : null, reachRadius());
  });

  ctx.onFrame(() => {
    if (!debugDraw.enabled) return;
    for (const { obstacle } of obstacles) {
      const shape = obstacle.shape;
      const options = { color: "green", category: "obstacles" } as const;
      if (shape.kind === "circle") debugDraw.circle(shape, shape.r, options);
      else debugDraw.path(boxCorners(shape), { ...options, closed: true });
    }
    // The player's collision footprint (a circle or a pill) and facing, to compare with the body.
    drawFootprint(player.transform.position, player.transform.rotation.y);
    const nav = navGraphOf(world, PLAYER.radius);
    if (nav) drawNavGraph(nav);
  });
}

/**
 * The player's grey-box body: its movement collider, a capsule standing on its origin (see
 * `shapePlayerBody`), and a nose showing the facing.
 */
function playerBody(ctx: SceneContext): Mesh {
  const body = new Mesh("player", ctx.scene);
  body.material = ctx.own(
    greyboxMaterial("player", ctx.scene, PLAYER_COLOR, { roughness: 0.7, emissive: PLAYER_GLOW }),
  );
  body.receiveShadows = true;

  const nose = ctx.own(
    MeshBuilder.CreateBox("playerNose", { width: 0.16, height: 0.16, depth: 0.3 }, ctx.scene),
  );
  nose.parent = body;
  nose.material = ctx.own(
    greyboxMaterial("playerNose", ctx.scene, PLAYER_COLOR.scale(0.45), { roughness: 0.7 }),
  );
  nose.isPickable = false;
  shapePlayerBody(body, nose);
  return body;
}

/** (Re)builds the grey-box body's geometry for the current movement radius. */
function shapePlayerBody(body: Mesh, nose: Mesh): void {
  const radius = PLAYER.radius;
  const shape = VertexData.CreateCapsule({ radius, height: PLAYER_HEIGHT, tessellation: 16 });
  shape.transform(Matrix.Translation(0, PLAYER_HEIGHT / 2, 0));
  shape.applyToMesh(body, true);
  body.refreshBoundingInfo();
  nose.position = new Vector3(0, PLAYER_HEIGHT * 0.7, radius + 0.08);
}

/**
 * The `footprint` debug category: the player's movement circle (what collides with walls and
 * paths) in yellow with an arrow along its facing, and the body's own shape (a pill: its hit shape
 * from 2.1) in red.
 */
function drawFootprint(at: Vec2, facing: number): void {
  const movement = { color: "yellow", category: "footprint" } as const;
  debugDraw.circle(at, PLAYER.radius, movement);
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const reach = PLAYER.radius * 1.6;
  debugDraw.arrow(at, { x: at.x + dx * reach, z: at.z + dz * reach }, movement);

  const body = { color: "red", category: "footprint" } as const;
  const shape = { radius: PLAYER.bodyRadius, length: PLAYER.bodyLength };
  const half = halfSpine(shape);
  const circles = footprintCircles(shape, facing);
  const front = circles.at(-1) ?? { x: 0, z: 0 };
  const back = circles[0] ?? { x: 0, z: 0 };
  debugDraw.circle({ x: at.x + front.x, z: at.z + front.z }, shape.radius, body);
  if (half <= 0) return;
  debugDraw.circle({ x: at.x + back.x, z: at.z + back.z }, shape.radius, body);
  // The sides: offset sideways (right of the facing is (dz, -dx)).
  for (const side of [1, -1]) {
    const ox = dz * shape.radius * side;
    const oz = -dx * shape.radius * side;
    debugDraw.line(
      { x: at.x + front.x + ox, z: at.z + front.z + oz },
      { x: at.x + back.x + ox, z: at.z + back.z + oz },
      body,
    );
  }
}

/**
 * The grown obstacle outlines (`navgraph`) and, in their own `navedges` category, the graph's
 * tangents, drawn only while that one is shown (there are thousands).
 */
function drawNavGraph(nav: NavGraph): void {
  const options = { color: "cyan", category: "navgraph" } as const;
  for (const shape of nav.shapes) {
    debugDraw.path(grownOutline(shape, nav.pad), { ...options, closed: true });
  }
  // Drawing is what lists a category in the pane; this one is skipped while hidden, so list it.
  if (!debugDraw.categories.has("navedges")) debugDraw.setCategory("navedges", false);
  if (!debugDraw.categories.get("navedges")) return;
  const grey = { color: "grey", category: "navedges" } as const;
  // Each tangent adds four nodes (both ends, both ways); draw it once, from its first node.
  for (let node = 0; node < nav.tangentTo.length; node += 4) {
    const to = nav.tangentTo[node] as number;
    debugDraw.line(
      { x: nav.nodeX[node] as number, z: nav.nodeZ[node] as number },
      { x: nav.nodeX[to] as number, z: nav.nodeZ[to] as number },
      grey,
    );
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
