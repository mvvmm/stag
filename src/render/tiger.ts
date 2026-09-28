import {
  type Animation,
  type InstantiatedEntries,
  Matrix,
  Mesh,
  type Node,
  PBRMaterial,
  Quaternion,
  type Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { TICK_DT } from "@/core/constants";
import { wrapAngle } from "@/core/math";
import { defineTunables } from "@/core/tuning";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import {
  bankAngle,
  clipTime,
  type Gait,
  gaitBlend,
  lookYaw,
  type Spring,
  snapSpring,
  stepSpring,
} from "@/render/locomotionAnim";
import { instantiateModel, modelMaterials } from "@/render/models";
import { addRimLight } from "@/render/rimMaterial";

// The player's placeholder body (1.6): the tiger model, its gait clips blended by the player's
// speed, and procedural layers on top (breathing, leaning into turns, tilting with acceleration,
// the tail swinging, the head looking at the aim point). View-only: it reads the player and the
// input each tick and runs on the view's time (`viewTime`), so pause, frame step, time scale and
// replays show the same motion. See locomotionAnim.ts for the math.

const DEG = Math.PI / 180;

export const TIGER = defineTunables("tiger", {
  /** Size relative to the real tiger (2.4 m nose to tail tip, 0.93 m at the hip). */
  scale: { value: 0.5, min: 0.2, max: 1.2, step: 0.01 },
  /** How far the model sits back from the entity, real size, m (× scale): its origin is at the hips. */
  offset: { value: 0.35, min: -1, max: 1, step: 0.01 },
  /** Scales the direct light (moon and the player's warm light) on its fur: right under the warm
   * light its back faces it head-on and would blow out. */
  light: { value: 0.5, min: 0, max: 2, step: 0.01 },
  /** Ground speed at which each clip's feet stick at 1× playback, real size, m/s (× scale). */
  walkSpeed: { value: 0.55, min: 0.1, max: 3, step: 0.01 },
  trotSpeed: { value: 1.85, min: 0.3, max: 6, step: 0.01 },
  runSpeed: { value: 5, min: 1, max: 15, step: 0.05 },
});

export const ANIM = defineTunables("anim", {
  /** Below this speed (m/s) the idle fades in. */
  idleBelow: { value: 0.25, min: 0, max: 2, step: 0.01 },
  /** Fastest playback, as a multiple of a clip's own rate (past it the feet slide). */
  maxRate: { value: 1.8, min: 1, max: 4, step: 0.05 },
  /** Slowest playback while moving, as a multiple of a clip's own rate. */
  minRate: { value: 0.5, min: 0.1, max: 1, step: 0.05 },
  /** Time constant smoothing the speed the gaits follow, s. */
  speedLag: { value: 0.06, min: 0, max: 0.5, step: 0.01 },
  /** Breathing while idle: chest pitch in degrees, and breaths per second. */
  breath: { value: 1.5, min: 0, max: 6, step: 0.1 },
  breathRate: { value: 0.35, min: 0.05, max: 2, step: 0.01 },
  /** Banking into turns: 1 = the physically balanced lean, clamped to `leanMax` degrees. */
  lean: { value: 0.6, min: 0, max: 2, step: 0.05 },
  leanMax: { value: 14, min: 0, max: 40, step: 0.5 },
  /** Pitch per m/s² of acceleration along the facing (nose down speeding up), degrees. */
  tilt: { value: 0.12, min: 0, max: 1, step: 0.01 },
  tiltMax: { value: 7, min: 0, max: 30, step: 0.5 },
  /** How fast lean and tilt follow (Hz, critically damped). */
  bodyFrequency: { value: 3, min: 0.5, max: 12, step: 0.1 },
  /** Tail swing per rad/s of turning, degrees (it swings out of the turn), and its spring. */
  tail: { value: 18, min: 0, max: 60, step: 0.5 },
  tailMax: { value: 50, min: 0, max: 90, step: 1 },
  tailFrequency: { value: 1.6, min: 0.3, max: 6, step: 0.05 },
  tailDamping: { value: 0.35, min: 0.05, max: 1.5, step: 0.01 },
  /** Head looking at the aim point: the most it turns (degrees) and how fast it follows (Hz). */
  headLook: { value: true },
  headMax: { value: 60, min: 0, max: 120, step: 1 },
  headFrequency: { value: 2.5, min: 0.3, max: 10, step: 0.1 },
});

/** The model faces −X in its file: this yaw turns it to face +Z (the sim's yaw 0). */
const MODEL_YAW = -Math.PI / 2;
/** The model is in centimeters. */
const MODEL_UNITS = 0.01;
/** Hip height at real size, m: the pivot the body leans and tilts around. */
const HIP_HEIGHT = 0.93;
/** Where each gait's left hind foot is furthest forward (fraction of the clip), to line them up. */
const GAIT_CLIPS = [
  { name: "walk", offset: 0.436 },
  { name: "trot", offset: 0 },
  { name: "run", offset: 0.083 },
] as const;
const IDLE_CLIP = "idle";
/** Longer than this between two frames (a replay seek), the springs snap instead of swinging. */
const MAX_STEP = 0.25;

const BONES = {
  chest: "Bip01 Spine1",
  neck: "Bip01 Neck",
  head: "Bip01 Head",
  tail: ["Bip01 Tail", "Bip01 Tail1", "Bip01 Tail2", "Bip01 Tail3"],
} as const;
/** How the head's turn is shared between the neck and the head, and the tail's between its bones. */
const LOOK_SHARE = [0.45, 0.55];
const TAIL_SHARE = [0.15, 0.25, 0.3, 0.3];

type Property = "rotationQuaternion" | "position" | "scaling";
/** One animated property of one node, with its animation in each clip (or null). */
type Channel = { node: TransformNode; property: Property; clips: (Animation | null)[] };

export type TigerBody = {
  /** An empty mesh carrying the model: bind it to the player (mesh sync moves it). */
  root: Mesh;
  /** Per tick, with the player after the tick and the input it saw. */
  tick(player: Entity, input: InputFrame): void;
  /** Per frame, before rendering, with the view time (`ctx.viewTime()`). */
  update(viewTime: number): void;
  dispose(): void;
};

/** The tiger for `scene`, or null if its model didn't load. */
export function createTiger(scene: Scene): TigerBody | null {
  const entries = instantiateModel("tiger");
  if (!entries) return null;
  const materials = modelMaterials("tiger");
  for (const material of materials) addRimLight(material);

  const root = new Mesh("player", scene);
  const body = new TransformNode("tigerBody", scene);
  body.parent = root;
  const rig = new TransformNode("tigerRig", scene);
  rig.parent = body;
  rig.rotation.y = MODEL_YAW;
  for (const node of entries.rootNodes) node.parent = rig;
  for (const mesh of root.getChildMeshes()) mesh.receiveShadows = true;

  const nodes = new Map<string, TransformNode>();
  for (const node of rig.getDescendants(false)) {
    if (node instanceof TransformNode) nodes.set(node.name, node);
  }
  // Bone nodes are named like "Bip01 Spine1_03_11" (the exporter's suffix).
  const bone = (name: string) => {
    const node = nodes.get(name) ?? [...nodes.values()].find((n) => n.name.startsWith(`${name}_`));
    if (!node) throw new Error(`tiger: no bone "${name}"`);
    return node;
  };
  const chest = bone(BONES.chest);
  const neck = bone(BONES.neck);
  const head = bone(BONES.head);
  const tailBones = BONES.tail.map(bone);

  // Clips in blend order: the idle, then the gaits.
  const clipNames = [IDLE_CLIP, ...GAIT_CLIPS.map((clip) => clip.name)];
  const channels = collectChannels(entries, clipNames);
  const durations = clipNames.map((name) => {
    const group = entries.animationGroups.find((g) => g.name === name);
    return group ? (group.to - group.from) / 60 : 1;
  });

  // Per tick, from the simulation.
  let speed = 0;
  let turnRate = 0;
  let accel = 0;
  let forwardSpeed = 0;
  let aim = { x: 0, z: 0 };
  let hasTick = false;

  // Per frame, on the view's time.
  let lastTime: number | null = null;
  let smoothSpeed = 0;
  let phase = 0;
  let breath = 0;
  const lean: Spring = { value: 0, velocity: 0 };
  const tilt: Spring = { value: 0, velocity: 0 };
  const tail: Spring = { value: 0, velocity: 0 };
  const look: Spring = { value: 0, velocity: 0 };
  const snap = () => {
    smoothSpeed = speed;
    for (const spring of [lean, tilt, tail, look]) snapSpring(spring);
  };

  const gaits = (): Gait[] => {
    const speeds = [TIGER.walkSpeed, TIGER.trotSpeed, TIGER.runSpeed];
    return GAIT_CLIPS.map((_, i) => ({
      speed: (speeds[i] as number) * TIGER.scale,
      duration: durations[i + 1] as number,
    }));
  };

  const pose = new Quaternion();
  const sampled = new Quaternion();
  const vector = new Vector3();

  /** Blends the clips into the bones: `weights` per clip in `clipNames` order, at `times`. */
  const applyPose = (weights: number[], times: number[]) => {
    for (const channel of channels) {
      let total = 0;
      if (channel.property === "rotationQuaternion") {
        pose.set(0, 0, 0, 0);
        channel.clips.forEach((animation, i) => {
          const weight = weights[i] as number;
          if (!animation || weight <= 0) return;
          sampled.copyFrom(animation.evaluate((times[i] as number) * animation.framePerSecond));
          // Same hemisphere as what's summed so far, so the blend takes the short way.
          const sign = Quaternion.Dot(pose, sampled) < 0 ? -1 : 1;
          pose.x += sampled.x * weight * sign;
          pose.y += sampled.y * weight * sign;
          pose.z += sampled.z * weight * sign;
          pose.w += sampled.w * weight * sign;
          total += weight;
        });
        if (total <= 0) continue;
        pose.normalize();
        channel.node.rotationQuaternion ??= new Quaternion();
        channel.node.rotationQuaternion.copyFrom(pose);
      } else {
        vector.setAll(0);
        channel.clips.forEach((animation, i) => {
          const weight = weights[i] as number;
          if (!animation || weight <= 0) return;
          const value = animation.evaluate(
            (times[i] as number) * animation.framePerSecond,
          ) as Vector3;
          vector.addInPlace(value.scale(weight));
          total += weight;
        });
        if (total <= 0) continue;
        channel.node[channel.property].copyFrom(vector.scaleInPlace(1 / total));
      }
    }
  };

  const up = Vector3.Up();
  const side = new Vector3();

  return {
    root,

    tick(player, input) {
      const velocity = player.mover?.velocity;
      const transform = player.transform;
      if (!transform) return;
      const facing = transform.rotation.y;
      const vx = velocity?.x ?? 0;
      const vz = velocity?.z ?? 0;
      speed = Math.hypot(vx, vz);
      const along = vx * Math.sin(facing) + vz * Math.cos(facing);
      const prev = player.prevTransform?.rotation.y ?? facing;
      turnRate = wrapAngle(facing - prev) / TICK_DT;
      accel = hasTick ? (along - forwardSpeed) / TICK_DT : 0;
      forwardSpeed = along;
      aim = input.aim;
      hasTick = true;
    },

    update(viewTime) {
      const dt = lastTime === null ? 0 : viewTime - lastTime;
      lastTime = viewTime;
      if (dt < 0 || dt > MAX_STEP) snap();
      const step = dt > 0 && dt <= MAX_STEP ? dt : 0;

      // Size and the pivot the body leans around.
      const scale = TIGER.scale;
      const pivot = HIP_HEIGHT * scale * 0.6;
      body.position.y = pivot;
      rig.position.y = -pivot;
      rig.position.z = -TIGER.offset * scale;
      rig.scaling.setAll(MODEL_UNITS * scale);
      for (const material of materials) {
        if (material instanceof PBRMaterial) material.directIntensity = TIGER.light;
      }

      // Gaits.
      const follow = ANIM.speedLag > 0 ? 1 - Math.exp(-step / ANIM.speedLag) : 1;
      smoothSpeed += (speed - smoothSpeed) * follow;
      const blend = gaitBlend(smoothSpeed, gaits(), ANIM);
      phase = (phase + blend.cyclesPerSecond * step) % 1;
      breath = (breath + ANIM.breathRate * step) % 1;
      const weights = [blend.idle, ...blend.weights];
      const times = [
        0,
        ...GAIT_CLIPS.map((clip, i) => clipTime(phase, clip.offset, durations[i + 1] as number)),
      ];
      applyPose(weights, times);

      // Lean and tilt: the whole body around the pivot (x = pitch, z = bank; the model's own
      // frame is turned under it, so these are the body's axes).
      stepSpring(
        lean,
        bankAngle(smoothSpeed, turnRate, ANIM.lean, ANIM.leanMax * DEG),
        ANIM.bodyFrequency,
        1,
        step,
      );
      const pitch = Math.max(-ANIM.tiltMax, Math.min(ANIM.tiltMax, accel * ANIM.tilt)) * DEG;
      stepSpring(tilt, pitch, ANIM.bodyFrequency, 1, step);
      body.rotation.set(tilt.value, 0, -lean.value);

      // Bone layers, parent to child, each around a world axis.
      root.computeWorldMatrix(true);
      const facing = root.rotation.y;
      side.set(Math.cos(facing), 0, -Math.sin(facing));
      const breathing = Math.sin(breath * 2 * Math.PI) * ANIM.breath * DEG * blend.idle;
      rotateAroundWorld(chest, side, -breathing);
      rotateAroundWorld(neck, side, breathing);

      const lookTarget = ANIM.headLook
        ? lookYaw(root.position, facing, aim, ANIM.headMax * DEG)
        : 0;
      stepSpring(look, lookTarget, ANIM.headFrequency, 1, step);
      rotateAroundWorld(neck, up, look.value * (LOOK_SHARE[0] as number));
      rotateAroundWorld(head, up, look.value * (LOOK_SHARE[1] as number));

      const swing = Math.max(-ANIM.tailMax, Math.min(ANIM.tailMax, -turnRate * ANIM.tail)) * DEG;
      stepSpring(tail, swing, ANIM.tailFrequency, ANIM.tailDamping, step);
      tailBones.forEach((node, i) => {
        rotateAroundWorld(node, up, tail.value * (TAIL_SHARE[i] as number));
      });
    },

    dispose() {
      entries.dispose();
      rig.dispose();
      body.dispose();
      root.dispose();
    },
  };
}

/** Every animated node property of the model, with its animation in each named clip. */
function collectChannels(entries: InstantiatedEntries, clipNames: readonly string[]): Channel[] {
  const byKey = new Map<string, Channel>();
  clipNames.forEach((name, i) => {
    const group = entries.animationGroups.find((g) => g.name === name);
    if (!group) throw new Error(`tiger: no "${name}" clip`);
    for (const { animation, target } of group.targetedAnimations) {
      if (!(target instanceof TransformNode)) continue;
      const property = animation.targetProperty as Property;
      if (property !== "rotationQuaternion" && property !== "position" && property !== "scaling") {
        continue;
      }
      const key = `${target.uniqueId}:${property}`;
      let channel = byKey.get(key);
      if (!channel) {
        channel = { node: target, property, clips: clipNames.map(() => null) };
        byKey.set(key, channel);
      }
      channel.clips[i] = animation;
    }
  });
  return [...byKey.values()];
}

const parentWorld = new Matrix();
const parentInverse = new Matrix();
const rotation = new Matrix();
const local = new Matrix();
const result = new Matrix();
const axisInParent = new Vector3();
const scratchScale = new Vector3();
const scratchQuat = new Quaternion();
const scratchPos = new Vector3();

/**
 * Turns `node` by `angle` around a world-space `axis` through its origin, whatever its parents'
 * rotation, scale or mirroring: the axis is carried into the parent's space and the turn is
 * applied on top of the node's local rotation.
 */
function rotateAroundWorld(node: TransformNode, axis: Vector3, angle: number): void {
  if (angle === 0) return;
  const parent = node.parent as Node | null;
  refreshWorld(parent);
  if (parent instanceof TransformNode) parentWorld.copyFrom(parent.getWorldMatrix());
  else parentWorld.copyFrom(Matrix.IdentityReadOnly);
  parentWorld.invertToRef(parentInverse);
  // The axis as a direction in the parent's space; a mirrored parent flips the turn's sense.
  Vector3.TransformNormalToRef(axis, parentInverse, axisInParent);
  axisInParent.normalize();
  const mirrored = parentWorld.determinant() < 0 ? -1 : 1;
  Matrix.RotationAxisToRef(axisInParent, angle * mirrored, rotation);
  node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
  Matrix.ComposeToRef(Vector3.OneReadOnly, node.rotationQuaternion, Vector3.ZeroReadOnly, local);
  local.multiplyToRef(rotation, result);
  result.decompose(scratchScale, scratchQuat, scratchPos);
  node.rotationQuaternion.copyFrom(scratchQuat);
}

/** Recomputes the world matrices from the top of `node`'s chain down, so they're current. */
function refreshWorld(node: Node | null): void {
  if (!node) return;
  refreshWorld(node.parent);
  if (node instanceof TransformNode) node.computeWorldMatrix(true);
}
