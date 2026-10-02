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
  createBend,
  createGaitDriver,
  type DriverOptions,
  type Gait,
  lookYaw,
  pushOffCurve,
  type ShuffleGate,
  type Spring,
  snapSpring,
  stepBend,
  stepChain,
  stepGaits,
  stepShuffle,
  stepSpring,
  sway,
} from "@/render/locomotionAnim";
import { instantiateModel, modelMaterials } from "@/render/models";
import { addRimLight } from "@/render/rimMaterial";

// The player's placeholder body (1.6): the tiger model, its gait clips blended by the player's
// speed, and procedural layers on top (breathing, leaning into turns, tilting with acceleration,
// the tail swinging, the head looking at the aim point). View-only: it reads the player and the
// input each tick and runs on the view's time (`viewTime`), so pause, frame step, time scale and
// replays show the same motion. See locomotionAnim.ts for the math. 1.7 made it fluid at the sim's
// near-instant turns and stops: the spine bends through turns, starts push off, stops finish the
// step and settle, and short moves shuffle.

const DEG = Math.PI / 180;

export const TIGER = defineTunables("tiger", {
  /** Size relative to the real tiger: 2.0 m nose to rump (plus a 1 m tail), 0.93 m at the hip.
   * The body's hit shape (`player.bodyRadius`/`bodyLength`) should match it. */
  scale: { value: 1, min: 0.2, max: 1.5, step: 0.01 },
  /** How far the model sits back from the entity, real size, m (× scale), so the body between
   * nose and rump is centered on it. */
  offset: { value: -0.05, min: -1, max: 1, step: 0.01 },
  /** Scales the direct light (moon and the player's warm light) on its fur: right under the warm
   * light its back faces it head-on and would blow out. */
  light: { value: 0.3, min: 0, max: 2, step: 0.01 },
  /** Ground speed at which each clip's feet stick at 1× playback, real size, m/s (× scale). */
  walkSpeed: { value: 0.55, min: 0.1, max: 3, step: 0.01 },
  trotSpeed: { value: 1.85, min: 0.3, max: 6, step: 0.01 },
  runSpeed: { value: 5, min: 1, max: 15, step: 0.05 },
  /** The gallop has fully taken over from the trot by this speed, real size, m/s (× scale): the
   * 4 m/s cruise is the gallop alone, slowed down, not a mix of two rhythms. */
  runFrom: { value: 3, min: 1, max: 15, step: 0.05 },
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
  /** How long the clip weights take to follow (cross-fades, settling into the idle), s. */
  fade: { value: 0.08, min: 0, max: 0.5, step: 0.01 },
  /** Starting from standing, the stride starts here (cycles): the push-off foot. */
  startPhase: { value: 0, min: 0, max: 1, step: 0.01 },
  /** Push-off on a start from standing: nose down (degrees), the hips dipping (m, real size),
   * over this long (s). */
  pushOff: { value: 6, min: 0, max: 25, step: 0.5 },
  pushOffDip: { value: 0.06, min: 0, max: 0.3, step: 0.005 },
  pushOffTime: { value: 0.22, min: 0.05, max: 0.6, step: 0.01 },
  /** Stopping finishes the step: the gait strides on to the next planted point, at most this
   * long (s), then fades into the idle. 0 = cross-fade straight away. */
  stopMax: { value: 0.25, min: 0, max: 0.6, step: 0.01 },
  /** Stop settle: braking pitches the body forward (degrees per m/s² of braking, at most
   * `settleMax`), then it rocks back once and settles (Hz, damping ratio). */
  settle: { value: 0.12, min: 0, max: 1, step: 0.01 },
  settleMax: { value: 6, min: 0, max: 20, step: 0.5 },
  settleFrequency: { value: 2.2, min: 0.5, max: 8, step: 0.1 },
  settleDamping: { value: 0.35, min: 0.05, max: 1.5, step: 0.01 },
  /** Short moves shuffle (walk steps) instead of flickering into the gallop: a right-click path
   * up to `shuffleDistance` (m), or a key held up to `shuffleTime` (s). */
  shuffle: { value: true },
  shuffleDistance: { value: 1, min: 0, max: 4, step: 0.05 },
  shuffleTime: { value: 0.12, min: 0, max: 0.5, step: 0.01 },
  /** A shuffle's stride rate, as a multiple of the walk's own. */
  shuffleRate: { value: 2, min: 0.5, max: 4, step: 0.05 },
  /** The spine bends through turns: the shoulders catch up with the facing (Hz, damping ratio:
   * below 1 they overshoot a little), the hips follow them (Hz), at most `bendMax` degrees
   * behind. */
  bend: { value: true },
  bendFrequency: { value: 7, min: 1, max: 20, step: 0.1 },
  bendDamping: { value: 0.65, min: 0.1, max: 1.5, step: 0.01 },
  bendHips: { value: 3.5, min: 0.5, max: 12, step: 0.1 },
  bendMax: { value: 40, min: 0, max: 80, step: 1 },
  /** Breathing while idle: chest pitch in degrees, and breaths per second. */
  breath: { value: 1.5, min: 0, max: 6, step: 0.1 },
  breathRate: { value: 0.35, min: 0.05, max: 2, step: 0.01 },
  /** Banking into turns: 1 = the physically balanced lean, clamped to `leanMax` degrees. */
  lean: { value: 0.6, min: 0, max: 2, step: 0.05 },
  leanMax: { value: 14, min: 0, max: 40, step: 0.5 },
  /** Pitch per m/s² of speeding up along the facing (nose down), degrees. */
  tilt: { value: 0.12, min: 0, max: 1, step: 0.01 },
  tiltMax: { value: 7, min: 0, max: 30, step: 0.5 },
  /** How fast lean and tilt follow (Hz, critically damped). */
  bodyFrequency: { value: 3, min: 0.5, max: 12, step: 0.1 },
  /** Tail swing per rad/s of (smoothed) turning, degrees: it swings out of the turn. */
  tail: { value: 10, min: 0, max: 60, step: 0.5 },
  tailMax: { value: 40, min: 0, max: 90, step: 1 },
  /** How fast the turn that drives the tail is smoothed (Hz): turns are near instant, the tail
   * shouldn't be. */
  tailDrive: { value: 3, min: 0.5, max: 20, step: 0.1 },
  /** Each tail bone springs after the one before it (Hz, damping ratio): lower = lazier whip. */
  tailFrequency: { value: 2.4, min: 0.3, max: 8, step: 0.05 },
  tailDamping: { value: 0.45, min: 0.05, max: 1.5, step: 0.01 },
  /** Idle sway, degrees, and its main rate (Hz): a slow, irregular swish while standing. */
  tailSway: { value: 8, min: 0, max: 40, step: 0.5 },
  tailSwayRate: { value: 0.25, min: 0.02, max: 2, step: 0.01 },
  /** Sway in time with the stride while moving, degrees. */
  tailStride: { value: 5, min: 0, max: 30, step: 0.5 },
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
  { name: "walk", offset: 0.425 },
  { name: "trot", offset: 0 },
  { name: "run", offset: 0.077 },
] as const;
const IDLE_CLIP = "idle";
/** Longer than this between two frames (a replay seek), the springs snap instead of swinging. */
const MAX_STEP = 0.25;

const BONES = {
  chest: "Bip01 Spine1",
  spine2: "Bip01 Spine2",
  neck: "Bip01 Neck",
  head: "Bip01 Head",
  tail: ["Bip01 Tail", "Bip01 Tail1", "Bip01 Tail2", "Bip01 Tail3"],
} as const;
/** How the head's turn is shared between the neck and the head, and the tail's between its bones. */
const LOOK_SHARE = [0.45, 0.55];
/** How the spine's bend is shared from the middle of the back to the neck (the front legs hang off
 * the neck, the hind legs and tail off the lower spine). */
const BEND_SHARE = [0.4, 0.35, 0.25];
/** Stop points sampled per stride cycle (how far each pose is from standing). */
const STOP_SAMPLES = 48;
/** How fast the braking that drives the stop settle fades, s. */
const BRAKE_FADE = 0.08;
const TAIL_SHARE = [0.2, 0.25, 0.27, 0.28];

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
  const spine2 = bone(BONES.spine2);
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
  const stopScores = stopScoreTable(channels, durations);

  // Per tick, from the simulation.
  let speed = 0;
  /** The speed the gaits play for: where it's heading while speeding up, so a start goes straight
   * into its gait. */
  let gaitSpeed = 0;
  let shuffle = false;
  /** How hard it's braking, m/s². */
  let braking = 0;
  const shuffleGate: ShuffleGate = { time: 0, committed: false };
  let turnRate = 0;
  let accel = 0;
  let forwardSpeed = 0;
  let aim = { x: 0, z: 0 };
  let hasTick = false;

  // Per frame, on the view's time.
  let lastTime: number | null = null;
  let smoothSpeed = 0;
  const driver = createGaitDriver(GAIT_CLIPS.length);
  let breath = 0;
  /** Seconds since the last start from standing (the push-off), and the braking it's settling. */
  let pushTime = Number.POSITIVE_INFINITY;
  let brake = 0;
  const settle: Spring = { value: 0, velocity: 0 };
  const bend = createBend();
  let lastFacing: number | null = null;
  const lean: Spring = { value: 0, velocity: 0 };
  const tilt: Spring = { value: 0, velocity: 0 };
  /** The smoothed turn rate driving the tail, and the tail's chain (one spring per bone). */
  const tailTurn: Spring = { value: 0, velocity: 0 };
  const tail: Spring[] = BONES.tail.map(() => ({ value: 0, velocity: 0 }));
  let time = 0;
  const look: Spring = { value: 0, velocity: 0 };
  const snap = () => {
    smoothSpeed = gaitSpeed;
    brake = 0;
    pushTime = Number.POSITIVE_INFINITY;
    for (const spring of [lean, tilt, settle, tailTurn, ...tail, look, bend.front, bend.hips]) {
      snapSpring(spring);
    }
    // The gaits jump straight to what they'd be showing.
    Object.assign(driver, createGaitDriver(GAIT_CLIPS.length));
    stepGaits(
      driver,
      gaitSpeed,
      shuffle,
      gaits(),
      { ...driverOptions(), fade: 0 },
      stopScore,
      1e-3,
    );
  };

  const gaits = (): Gait[] => {
    const speeds = [TIGER.walkSpeed, TIGER.trotSpeed, TIGER.runSpeed];
    const from = [undefined, undefined, Math.max(TIGER.runFrom, TIGER.trotSpeed)];
    return GAIT_CLIPS.map((_, i) => ({
      speed: (speeds[i] as number) * TIGER.scale,
      duration: durations[i + 1] as number,
      ...(from[i] !== undefined ? { from: (from[i] as number) * TIGER.scale } : {}),
    }));
  };
  const driverOptions = (): DriverOptions => ({
    idleBelow: ANIM.idleBelow,
    maxRate: ANIM.maxRate,
    minRate: ANIM.minRate,
    startPhase: ANIM.startPhase,
    shuffleRate: ANIM.shuffleRate,
    stopMax: ANIM.stopMax,
    fade: ANIM.fade,
  });
  /** How far the pose at a shared stride phase is from standing, for the gaits a stop holds. */
  const stopScore = (at: number) => {
    let total = 0;
    driver.held.forEach((weight, i) => {
      if (weight > 0) total += weight * sampleLoop(stopScores[i] ?? [], at);
    });
    return total;
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
      const lastSpeed = speed;
      speed = Math.hypot(vx, vz);
      const change = hasTick ? (speed - lastSpeed) / TICK_DT : 0;
      braking = Math.max(0, -change);
      const desired = player.mover?.desired;
      const wants = !!desired && (desired.x !== 0 || desired.z !== 0);
      const heading = desired ? Math.hypot(desired.x, desired.z) : 0;
      gaitSpeed = change > 0 && speed > 0.05 ? Math.max(speed, heading) : speed;
      const order = player.player?.order;
      let path: number | null = null;
      if (order) {
        path = 0;
        let from = transform.position as { x: number; z: number };
        for (const point of order.waypoints) {
          path += Math.hypot(point.x - from.x, point.z - from.z);
          from = point;
        }
      }
      const options = { distance: ANIM.shuffleDistance, time: ANIM.shuffleTime };
      shuffle = stepShuffle(shuffleGate, wants, path, options, TICK_DT) && ANIM.shuffle;
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

      // Gaits. The speed they follow rises at once (a start goes straight into its gait) and eases
      // down; a stop is a stop the moment the body stops.
      const follow = ANIM.speedLag > 0 ? 1 - Math.exp(-step / ANIM.speedLag) : 1;
      smoothSpeed =
        gaitSpeed > smoothSpeed ? gaitSpeed : smoothSpeed + (gaitSpeed - smoothSpeed) * follow;
      const moving = gaitSpeed > 1e-3 ? smoothSpeed : 0;
      stepGaits(driver, moving, shuffle, gaits(), driverOptions(), stopScore, step);
      if (driver.started) pushTime = 0;
      else pushTime += step;
      const phase = driver.phase;
      const idle = driver.weights[0] as number;
      breath = (breath + ANIM.breathRate * step) % 1;
      time += step;
      const times = [
        0,
        ...GAIT_CLIPS.map((clip, i) => clipTime(phase, clip.offset, durations[i + 1] as number)),
      ];
      applyPose(driver.weights, times);

      // Lean, tilt, push-off and settle: the whole body around the pivot (x = pitch, z = bank;
      // the model's own frame is turned under it, so these are the body's axes), and its yaw is
      // where the hips point (the spine bends the front back onto the facing below).
      stepSpring(
        lean,
        bankAngle(smoothSpeed, turnRate, ANIM.lean, ANIM.leanMax * DEG),
        ANIM.bodyFrequency,
        1,
        step,
      );
      const pitch = Math.min(ANIM.tiltMax, Math.max(0, accel) * ANIM.tilt) * DEG;
      stepSpring(tilt, pitch, ANIM.bodyFrequency, 1, step);
      brake = Math.max(brake * Math.exp(-step / BRAKE_FADE), braking);
      const forward = Math.min(ANIM.settleMax, brake * ANIM.settle) * DEG;
      stepSpring(settle, forward, ANIM.settleFrequency, ANIM.settleDamping, step);
      const push = pushOffCurve(pushTime, ANIM.pushOffTime);

      const facing = root.rotation.y;
      const turn = lastFacing === null ? 0 : wrapAngle(facing - lastFacing);
      lastFacing = facing;
      if (ANIM.bend) {
        const options = {
          frontFrequency: ANIM.bendFrequency,
          frontDamping: ANIM.bendDamping,
          hipFrequency: ANIM.bendHips,
          max: ANIM.bendMax * DEG,
        };
        stepBend(bend, step > 0 ? turn : 0, options, step);
      } else {
        snapSpring(bend.front);
        snapSpring(bend.hips);
      }

      body.position.y = pivot - push * ANIM.pushOffDip * scale;
      body.rotation.set(
        tilt.value + settle.value + push * ANIM.pushOff * DEG,
        bend.hips.value,
        -lean.value,
      );

      // Bone layers, parent to child, each around a world axis.
      root.computeWorldMatrix(true);
      const curve = bend.front.value - bend.hips.value;
      [chest, spine2, neck].forEach((node, i) => {
        rotateAroundWorld(node, up, curve * (BEND_SHARE[i] as number));
      });
      side.set(Math.cos(facing), 0, -Math.sin(facing));
      const breathing = Math.sin(breath * 2 * Math.PI) * ANIM.breath * DEG * idle;
      rotateAroundWorld(chest, side, -breathing);
      rotateAroundWorld(neck, side, breathing);

      const lookTarget = ANIM.headLook
        ? lookYaw(root.position, facing + bend.front.value, aim, ANIM.headMax * DEG)
        : 0;
      stepSpring(look, lookTarget, ANIM.headFrequency, 1, step);
      rotateAroundWorld(neck, up, look.value * (LOOK_SHARE[0] as number));
      rotateAroundWorld(head, up, look.value * (LOOK_SHARE[1] as number));

      // The tail: a whip-like chain driven by the smoothed turn (swinging out of it), a slow
      // irregular sway while standing, and a small sway in time with the stride while moving.
      stepSpring(tailTurn, turnRate, ANIM.tailDrive, 1, step);
      const turning = -tailTurn.value * ANIM.tail;
      const standing = sway(time, ANIM.tailSwayRate) * ANIM.tailSway * idle;
      const striding = Math.sin(2 * Math.PI * phase) * ANIM.tailStride * (1 - idle);
      const drive =
        Math.max(-ANIM.tailMax, Math.min(ANIM.tailMax, turning + standing + striding)) * DEG;
      stepChain(tail, drive, ANIM.tailFrequency, ANIM.tailDamping, step);
      tailBones.forEach((node, i) => {
        rotateAroundWorld(node, up, (tail[i]?.value ?? 0) * (TAIL_SHARE[i] as number));
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

/**
 * For each gait clip, how far its pose is from the idle's at each of `STOP_SAMPLES` points of the
 * shared stride (with the clip's footfall offset): the sum over the rotated nodes of the angle
 * between the two rotations. A stop strides on to a low point, where the feet are planted.
 */
function stopScoreTable(channels: Channel[], durations: number[]): number[][] {
  const a = new Quaternion();
  const b = new Quaternion();
  return GAIT_CLIPS.map((clip, g) => {
    const duration = durations[g + 1] as number;
    return Array.from({ length: STOP_SAMPLES }, (_, k) => {
      const at = clipTime(k / STOP_SAMPLES, clip.offset, duration);
      let total = 0;
      for (const channel of channels) {
        if (channel.property !== "rotationQuaternion") continue;
        const idle = channel.clips[0];
        const gait = channel.clips[g + 1];
        if (!idle || !gait) continue;
        a.copyFrom(idle.evaluate(0));
        b.copyFrom(gait.evaluate(at * gait.framePerSecond));
        total += 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(a, b))));
      }
      return total;
    });
  });
}

/** A looping table of samples over [0, 1), read linearly between them. */
function sampleLoop(table: number[], at: number): number {
  const n = table.length;
  if (n === 0) return 0;
  const x = (at - Math.floor(at)) * n;
  const i = Math.floor(x);
  const t = x - i;
  return (table[i % n] as number) * (1 - t) + (table[(i + 1) % n] as number) * t;
}
