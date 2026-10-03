import {
  type AbstractMesh,
  Color3,
  DynamicTexture,
  type Material,
  Matrix,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
  VertexData,
} from "@babylonjs/core";
import { debugDraw } from "@/core/debugDraw";
import { DUMMY_HEIGHT, DUMMY_HURTBOX } from "@/data/dummies";
import type { Entity } from "@/ecs/world";
import type { HoverMetadata } from "@/render/aim";
import { bodyView } from "@/render/bodyView";
import { addHighlight } from "@/render/highlightMaterial";
import { greyboxMaterial } from "@/render/materials";
import { instantiateModel } from "@/render/models";
import type { SceneContext } from "@/scenes/scene";
import { movementStats } from "@/systems/movementStats";

// The training dummies' view: a body per dummy (the Forest Guardian, or a grey-box capsule the
// size of its hurtbox), a health bar over each, and a number popping up for every hit. Bars and
// numbers live in the overlay scene, so fog and post never dim them.

/** The bar over a dummy: size in m, and how high its center sits. */
const BAR_WIDTH = 1.3;
const BAR_HEIGHT = 0.14;
const BAR_BORDER = 0.025;
const BAR_Y = DUMMY_HEIGHT + 0.45;
/** sRGB. */
const BAR_BACK = Color3.FromHexString("#0b0d12");
const BAR_FILL = Color3.FromHexString("#b3392e");
/** The part just lost, which drains after a moment. */
const BAR_CHIP = Color3.FromHexString("#ecd9a8");
/** Seconds the chip waits before draining, and how fast it drains (of the full bar per second). */
const CHIP_HOLD = 0.35;
const CHIP_DRAIN = 1.5;

/** Damage numbers: seconds on screen, how far they rise (m), and how many can show at once. */
const NUMBER_LIFE = 0.9;
const NUMBER_FADE = 0.35;
const NUMBER_RISE = 0.7;
const NUMBER_POOL = 24;
const NUMBER_SIZE = 0.55;
const NUMBER_Y = BAR_Y + 0.25;
/** Side-to-side offsets (m) cycled through, so numbers from quick hits don't stack exactly. */
const NUMBER_SPREAD = [0, 0.22, -0.18, 0.12, -0.26, 0.05];

/** Picking: an invisible cylinder round each dummy, this much wider than its hurtbox (m) and as
 * tall as the dummy plus `PICK_TOP`, so a click anywhere on (or just next to) the body counts. */
const PICK_PAD = 0.15;
const PICK_TOP = 0.3;

/** The grey-box stand-in. */
const STAND_IN_COLOR = new Color3(0.42, 0.47, 0.4);

/** How the Guardian is fitted to a dummy: its height, and the yaw that turns it to face +Z. */
const MODEL_HEIGHT = DUMMY_HEIGHT;
const MODEL_YAW = 0;
/** Its float: how high it hovers (m), how much it bobs (m) and how often (per second). */
const FLOAT = 0.06;
const BOB = 0.04;
const BOB_RATE = 0.55;
/** The glide's forward lean at full speed, radians. */
const LEAN = 0.12;

type DummyEntity = Entity & Required<Pick<Entity, "dummy" | "health" | "transform">>;

/** The body under the cursor (`input.hover`) glows. */

/**
 * Builds the dummies' bodies (each bound to its entity), their bars and their damage numbers.
 * Returns the bodies, for the shadow casters.
 */
export function createDummyViews(ctx: SceneContext): Mesh[] {
  const { world, overlay } = ctx;
  const dummies: DummyEntity[] = [...world.with("dummy", "health", "transform")];
  if (dummies.length === 0) return [];

  const bodies = dummies.map((entity, i) => {
    const body = dummyBody(ctx, entity, i);
    ctx.bindMesh(entity, body.root);
    return body;
  });

  const bars = dummies.map((entity) => healthBar(ctx, overlay, entity));
  const numbers = damageNumbers(ctx, overlay);

  ctx.onTick(() => {
    const now = ctx.viewTime();
    for (const entity of dummies) {
      const { position } = entity.transform;
      for (const amount of entity.health.taken) numbers.spawn(amount, position.x, position.z, now);
    }
  });

  ctx.onBeforeRender(() => {
    const time = ctx.viewTime();
    const hover = ctx.input.hover;
    bodies.forEach((body, i) => {
      body.update(time);
      body.highlight(hover !== null && dummies[i]?.uid === hover);
    });
    for (const bar of bars) bar.update(time);
    numbers.update(time);
  });

  ctx.onFrame(() => {
    if (!debugDraw.enabled) return;
    for (const entity of dummies) {
      const at = entity.transform.position;
      const solid = { color: "yellow", category: "footprint" } as const;
      debugDraw.circle(at, movementStats(entity).radius, solid);
      const hurtbox = entity.hurtbox;
      if (hurtbox) debugDraw.circle(at, hurtbox.radius, { color: "red", category: "footprint" });
    }
  });

  return bodies.map((body) => body.root);
}

/**
 * A dummy's body: an empty root the entity moves, a float node that hovers, bobs and leans into a
 * glide, and under it the model and the grey-box stand-in (one shown at a time).
 */
function dummyBody(ctx: SceneContext, entity: DummyEntity, index: number) {
  const { scene } = ctx;
  const root = ctx.own(new Mesh(`dummy-${index}`, scene));
  const float = ctx.own(new TransformNode(`dummyFloat-${index}`, scene));
  float.parent = root;

  const radius = entity.hurtbox?.radius ?? DUMMY_HURTBOX.radius;
  const standIn = ctx.own(new Mesh(`dummyStandIn-${index}`, scene));
  const shape = VertexData.CreateCapsule({ radius, height: DUMMY_HEIGHT, tessellation: 16 });
  shape.transform(Matrix.Translation(0, DUMMY_HEIGHT / 2, 0));
  shape.applyToMesh(standIn);
  // Its own materials (the stand-in's and the model's copies), so it glows on its own when hovered.
  const standInMaterial = ctx.own(
    greyboxMaterial(`dummyStandIn-${index}`, scene, STAND_IN_COLOR, { roughness: 0.8 }),
  );
  standIn.material = standInMaterial;
  standIn.receiveShadows = true;
  standIn.parent = root;

  const model = instantiateModel("guardian", { cloneMaterials: true });
  const modelRoot = ctx.own(new TransformNode(`dummyModel-${index}`, scene));
  modelRoot.parent = float;
  if (model) {
    ctx.onDispose(() => model.dispose());
    for (const node of model.rootNodes) node.parent = modelRoot;
    fitModel(modelRoot);
    for (const mesh of modelRoot.getChildMeshes()) mesh.receiveShadows = true;
  }
  const materials = new Set<Material>([standInMaterial]);
  for (const mesh of modelRoot.getChildMeshes()) {
    if (mesh.material && !materials.has(mesh.material)) {
      materials.add(ctx.own(mesh.material));
    }
  }
  const glows = [...materials].map(addHighlight);

  // Clicking: an invisible cylinder the screen pick finds (`render/aim.ts`).
  if (entity.uid !== undefined) {
    const height = DUMMY_HEIGHT + PICK_TOP;
    const pick = ctx.own(
      MeshBuilder.CreateCylinder(
        `dummyPick-${index}`,
        { height, diameter: (radius + PICK_PAD) * 2, tessellation: 12 },
        scene,
      ),
    );
    pick.position.y = height / 2;
    pick.parent = root;
    pick.isVisible = false;
    pick.metadata = { hoverUid: entity.uid } satisfies HoverMetadata;
  }

  // Each dummy bobs out of step with the others.
  const phase = index * 1.7;
  const patrols = entity.dummy.kind === "patrol";
  let highlighted = false;
  return {
    root,
    /** Makes the body glow (hovered), or not. */
    highlight(on: boolean) {
      if (on === highlighted) return;
      highlighted = on;
      for (const glow of glows) glow(on ? 1 : 0);
    },
    update(time: number) {
      const useStandIn = !model || bodyView.hitboxes;
      standIn.setEnabled(useStandIn);
      modelRoot.setEnabled(!useStandIn);
      const bob = Math.sin((time * BOB_RATE + phase / (Math.PI * 2)) * Math.PI * 2);
      float.position.y = FLOAT + BOB * bob;
      // Leans into its glide, by how fast it's going (a view of the sim's velocity).
      const v = entity.mover?.velocity;
      const speed = v ? Math.hypot(v.x, v.z) : 0;
      float.rotation.x = patrols ? LEAN * Math.min(1, speed / 2) : 0;
      float.rotation.z = 0.03 * bob;
    },
  };
}

/** Scales and turns the model so it stands `MODEL_HEIGHT` tall on its origin, facing +Z. */
function fitModel(node: TransformNode): void {
  node.computeWorldMatrix(true);
  const { min, max } = node.getHierarchyBoundingVectors(true);
  const height = max.y - min.y;
  if (height <= 0) return;
  const scale = MODEL_HEIGHT / height;
  node.scaling.setAll(scale);
  node.rotation.y = MODEL_YAW;
  node.position.y = -min.y * scale;
}

/** A health bar over a dummy: a dark backing, the red fill, and a pale chip for what was just lost. */
function healthBar(ctx: SceneContext, overlay: Scene, entity: DummyEntity) {
  const node = ctx.own(new TransformNode("healthBar", overlay));
  node.billboardMode = TransformNode.BILLBOARDMODE_ALL;

  const plane = (name: string, color: Color3, width: number, height: number, z: number) => {
    const mesh = ctx.own(MeshBuilder.CreatePlane(name, { width: 1, height: 1 }, overlay));
    // Its origin on its left edge, so scaling x grows it rightward from there.
    mesh.bakeTransformIntoVertices(Matrix.Translation(0.5, 0, 0));
    mesh.scaling.set(width, height, 1);
    mesh.position.set(-width / 2, 0, z);
    mesh.isPickable = false;
    const material = ctx.own(new StandardMaterial(name, overlay));
    material.disableLighting = true;
    material.emissiveColor = color.toLinearSpace();
    material.backFaceCulling = false;
    mesh.material = material;
    mesh.parent = node;
    return mesh;
  };
  // Drawn back to front: farther from the camera is +z in billboard space.
  plane("healthBack", BAR_BACK, BAR_WIDTH + BAR_BORDER * 2, BAR_HEIGHT + BAR_BORDER * 2, 0.002);
  const chip = plane("healthChip", BAR_CHIP, BAR_WIDTH, BAR_HEIGHT, 0.001);
  const fill = plane("healthFill", BAR_FILL, BAR_WIDTH, BAR_HEIGHT, 0);

  const body = ctx.meshOf(entity);
  // The chip shows health a moment ago: it holds after a drop, then drains down to the fill.
  let shown = 1;
  let lastTime = Number.NaN;
  let holdUntil = 0;
  let last = 1;
  return {
    update(time: number) {
      const at = body?.position ?? entity.transform.position;
      node.position.set(at.x, BAR_Y, at.z);
      const { current, max } = entity.health;
      const fraction = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
      const dt = Number.isNaN(lastTime) ? 0 : time - lastTime;
      lastTime = time;
      if (fraction < last) holdUntil = time + CHIP_HOLD;
      last = fraction;
      // A refill, or time running backward (a replay seek): no chip.
      if (fraction > shown || dt < 0) shown = fraction;
      else if (time >= holdUntil) shown = Math.max(fraction, shown - CHIP_DRAIN * dt);
      fill.scaling.x = BAR_WIDTH * fraction;
      fill.setEnabled(fraction > 0);
      chip.scaling.x = BAR_WIDTH * shown;
      chip.setEnabled(shown > fraction);
    },
  };
}

/** Numbers that pop up where a dummy was hit, rise and fade. A fixed pool, oldest reused first. */
function damageNumbers(ctx: SceneContext, overlay: Scene) {
  type Slot = {
    mesh: AbstractMesh;
    texture: DynamicTexture;
    born: number;
    x: number;
    z: number;
  };
  const slots: Slot[] = [];
  for (let i = 0; i < NUMBER_POOL; i++) {
    const mesh = ctx.own(
      MeshBuilder.CreatePlane(
        `damageNumber-${i}`,
        { width: NUMBER_SIZE * 2, height: NUMBER_SIZE },
        overlay,
      ),
    );
    mesh.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    const texture = ctx.own(
      new DynamicTexture(`damageNumber-${i}`, { width: 256, height: 128 }, overlay, true),
    );
    texture.hasAlpha = true;
    const material = ctx.own(new StandardMaterial(`damageNumber-${i}`, overlay));
    material.disableLighting = true;
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;
    mesh.material = material;
    slots.push({ mesh, texture, born: Number.NEGATIVE_INFINITY, x: 0, z: 0 });
  }
  let next = 0;

  return {
    spawn(amount: number, x: number, z: number, time: number) {
      const slot = slots[next % NUMBER_POOL] as Slot;
      const spread = NUMBER_SPREAD[next % NUMBER_SPREAD.length] ?? 0;
      next++;
      drawNumber(slot.texture, Math.round(amount));
      slot.born = time;
      slot.x = x + spread;
      slot.z = z;
    },
    update(time: number) {
      for (const slot of slots) {
        const age = time - slot.born;
        // Not born yet (a replay seek went back) or done.
        const alive = age >= 0 && age < NUMBER_LIFE;
        slot.mesh.setEnabled(alive);
        if (!alive) continue;
        const t = age / NUMBER_LIFE;
        const rise = NUMBER_RISE * (1 - (1 - t) * (1 - t));
        slot.mesh.position.set(slot.x, NUMBER_Y + rise, slot.z);
        // A quick pop, then settle.
        const pop = age < 0.08 ? 0.7 + (0.5 * age) / 0.08 : Math.max(1, 1.2 - (age - 0.08) * 2);
        slot.mesh.scaling.setAll(pop);
        const fadeFrom = NUMBER_LIFE - NUMBER_FADE;
        slot.mesh.visibility = age < fadeFrom ? 1 : 1 - (age - fadeFrom) / NUMBER_FADE;
      }
    },
  };
}

function drawNumber(texture: DynamicTexture, value: number): void {
  // A real 2D canvas context (Babylon's type leaves out the text layout fields).
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const { width, height } = texture.getSize();
  context.clearRect(0, 0, width, height);
  context.font = "700 84px Georgia, 'Times New Roman', serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 10;
  context.strokeStyle = "rgba(10, 8, 6, 0.9)";
  const text = String(value);
  context.strokeText(text, width / 2, height / 2);
  context.fillStyle = "#f3e3bd";
  context.fillText(text, width / 2, height / 2);
  texture.update();
}
