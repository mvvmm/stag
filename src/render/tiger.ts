import {
  type Animation,
  Color3,
  Constants,
  type InstantiatedEntries,
  Matrix,
  Mesh,
  type Node,
  PBRMaterial,
  Quaternion,
  type Scene,
  StandardMaterial,
  TrailMesh,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { TICK_DT } from "@/core/constants";
import { wrapAngle } from "@/core/math";
import { defineTunables } from "@/core/tuning";
import { abilityById } from "@/data/abilities";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import {
  bankAngle,
  clipTime,
  contactPhase,
  createBend,
  createGaitDriver,
  type DriverOptions,
  type FootTrack,
  flicks,
  type Gait,
  lookYaw,
  noise,
  pairShift,
  pushOffCurve,
  type ShuffleGate,
  type Spring,
  type StrideFeet,
  type StrideMotion,
  sampleLoop,
  snapSpring,
  stepBend,
  stepChain,
  stepGaits,
  stepShuffle,
  stepSpring,
  strideMotion,
  swipePhase,
  swipeSide,
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
  /** Ground speed at which each clip's feet stick at 1× playback, real size, m/s (× scale). The
   * run's is measured from how fast its planted feet slide back (6.3–7.3 m/s). */
  walkSpeed: { value: 0.55, min: 0.1, max: 3, step: 0.01 },
  trotSpeed: { value: 1.85, min: 0.3, max: 6, step: 0.01 },
  runSpeed: { value: 7, min: 1, max: 15, step: 0.05 },
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
  /** The gallop as a bound (a cat's run, a string of pounces): how far each left and right leg
   * are pulled together in time, 0 = the clip's gallop (feet landing one by one), 1 = both hind
   * feet, then both front feet, land as one. */
  bound: { value: 1, min: 0, max: 1, step: 0.05 },
  /** The galloping body's motion, from where the feet are: bouncing up in flight and down on
   * the landings (m, real size, up from the landings' height), rocking nose up on the hind push and down on the front landing
   * (degrees), and the back arching into an upside-down V as the feet bunch up under it, then
   * flattening (a little past straight, `stretch` of the arch) as they spread out (degrees at
   * the peak). */
  bounce: { value: 0.18, min: 0, max: 0.3, step: 0.005 },
  rock: { value: 12, min: 0, max: 30, step: 0.5 },
  flex: { value: 32, min: 0, max: 40, step: 0.5 },
  stretch: { value: 0.6, min: 0, max: 1, step: 0.05 },
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
  /** Standing, the tail wanders side to side (degrees, and how fast the wander changes: wanders
   * per second), its lift and the curl of its tip wander too (degrees), and now and then it
   * swings bigger: one swing of `tailFlick` degrees lasting `tailFlickTime` (s), in about
   * `tailFlickChance` of every `tailFlickEvery` seconds. */
  tailSway: { value: 28, min: 0, max: 40, step: 0.5 },
  tailSwayRate: { value: 0.45, min: 0.02, max: 2, step: 0.01 },
  tailLift: { value: 14, min: 0, max: 40, step: 0.5 },
  tailCurl: { value: 25, min: 0, max: 60, step: 0.5 },
  tailFlick: { value: 55, min: 0, max: 60, step: 0.5 },
  tailFlickTime: { value: 0.9, min: 0.2, max: 3, step: 0.05 },
  tailFlickEvery: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
  tailFlickChance: { value: 0.55, min: 0, max: 1, step: 0.05 },
  /** Running, it swings in time with the stride (degrees), wanders faster on top (degrees, and
   * wanders per second), and rides higher (degrees). */
  tailStride: { value: 16, min: 0, max: 40, step: 0.5 },
  tailRunSway: { value: 14, min: 0, max: 40, step: 0.5 },
  tailRunRate: { value: 0.9, min: 0.05, max: 4, step: 0.05 },
  tailRunLift: { value: 14, min: -30, max: 40, step: 0.5 },
  /** Head looking at the aim point: the most it turns (degrees) and how fast it follows (Hz). */
  headLook: { value: true },
  headMax: { value: 60, min: 0, max: 120, step: 1 },
  headFrequency: { value: 2.5, min: 0.3, max: 10, step: 0.1 },
});

/**
 * The auto attack (2.2), modelled on Nidalee's cougar auto attack in League (studied frame by frame):
 * a coil, then the whole body exploding forward and up into a cross-body swipe, timed on the
 * cast's windup so the paw crosses the target when the hit lands. Made to read from the top-down
 * camera.
 * - Coil, over the first `cock` share of the windup: the body sinks (`crouch` m), pulls back
 *   (`windBack` m) and tips nose down (`coil` degrees); the shoulders (`twist`) and front
 *   (`turn`) wind toward the striking paw, which is cocked far out to its side (`out` degrees) at
 *   shoulder height (`lift`), the forearm folded (`curl`); the head draws back (`dip` < 0 is up)
 *   and keeps its eyes on the target (`eyes`).
 * - Strike, the rest of the windup, fastest at the hit: the body explodes forward and up, stretched
 *   long at the target (`lunge` m, `rise` m, `rear` degrees nose up); the paw sweeps in, reaching
 *   forward (`reach`), and crosses the middle (the target) on the hit.
 * - Follow-through, `follow` seconds: still stretched, the swing carries on past the other side
 *   (`across`), the body and shoulders turning with it and the head following the paw (`look`),
 *   over the first `through` share; then it settles back into the stance.
 * The hips swing against the front's turn (`hips`), the back bends with the pitch rather than the
 * whole body tilting (`bodyPitch`), and the tail whips against the swing (`tailWhip`, `tailLift`).
 * The hind feet don't slide with the lunge: they stay planted through the coil and the push-off
 * (the legs load, then extend behind), then hop (`hopFrom`, `hop`) and land as the body settles.
 * A windup called off by a move order fades out over `fade` seconds from where it was.
 */
export const SWIPE = defineTunables("swipe", {
  cock: { value: 0.7, min: 0.05, max: 0.95, step: 0.01 },
  lift: { value: 50, min: -90, max: 150, step: 1 },
  out: { value: 95, min: -90, max: 150, step: 1 },
  curl: { value: -70, min: -120, max: 120, step: 1 },
  reach: { value: 75, min: -90, max: 150, step: 1 },
  across: { value: 80, min: -90, max: 150, step: 1 },
  crouch: { value: 0.1, min: 0, max: 0.5, step: 0.005 },
  windBack: { value: 0.2, min: 0, max: 0.8, step: 0.005 },
  coil: { value: 8, min: -30, max: 30, step: 0.5 },
  rear: { value: 18, min: -30, max: 45, step: 0.5 },
  rise: { value: 0.16, min: 0, max: 0.5, step: 0.005 },
  lunge: { value: 0.45, min: 0, max: 1.5, step: 0.01 },
  twist: { value: 24, min: -60, max: 60, step: 0.5 },
  turn: { value: 20, min: -60, max: 60, step: 0.5 },
  hips: { value: 0.35, min: 0, max: 1, step: 0.05 },
  bodyPitch: { value: 0.4, min: 0, max: 1, step: 0.05 },
  tailWhip: { value: 0.8, min: 0, max: 3, step: 0.05 },
  tailLift: { value: 18, min: 0, max: 60, step: 0.5 },
  dip: { value: -8, min: -40, max: 40, step: 0.5 },
  look: { value: 0.4, min: 0, max: 1, step: 0.05 },
  /** How much of the coil's turn the head takes back, to keep its eyes on the target. */
  eyes: { value: 0.8, min: 0, max: 1.5, step: 0.05 },
  follow: { value: 0.4, min: 0, max: 1.5, step: 0.01 },
  through: { value: 0.3, min: 0, max: 0.95, step: 0.01 },
  /** The hind legs: planted (pushing off) until this far into the strike, then they hop off the
   * ground (`hop` m up) and travel forward with the lunge, landing as it settles. 0 = no IK. */
  hopFrom: { value: 0.55, min: 0, max: 1, step: 0.01 },
  hop: { value: 0.08, min: 0, max: 0.4, step: 0.005 },
  hindLegs: { value: true },
  /** A glowing arc behind the striking paw. */
  trail: { value: true },
  fade: { value: 0.12, min: 0, max: 0.5, step: 0.01 },
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
  /** The lower spine: the hind legs and the tail hang off it. */
  spine: "Bip01 Spine",
  chest: "Bip01 Spine1",
  spine2: "Bip01 Spine2",
  neck: "Bip01 Neck",
  head: "Bip01 Head",
  tail: ["Bip01 Tail", "Bip01 Tail1", "Bip01 Tail2", "Bip01 Tail3"],
  /** The swiping legs (shoulder, upper arm, forearm, paw tip), right and left. */
  rightPaw: ["Bip01 R Clavicle", "Bip01 R UpperArm", "Bip01 R Forearm", "Bip01 R Finger0"],
  leftPaw: ["Bip01 L Clavicle", "Bip01 L UpperArm", "Bip01 L Forearm", "Bip01 L Finger0"],
} as const;
/** How the head's turn is shared between the neck and the head, and the tail's between its bones. */
const LOOK_SHARE = [0.45, 0.55];
/** How the spine's bend is shared from the middle of the back to the neck (the front legs hang off
 * the neck, the hind legs and tail off the lower spine). */
const BEND_SHARE = [0.4, 0.35, 0.25];
/** Samples per stride when working out the stop points and the gallop's body motion. */
const STRIDE_SAMPLES = 48;
/** How fast the braking that drives the stop settle fades, s. */
const BRAKE_FADE = 0.08;
const TAIL_SHARE = [0.2, 0.25, 0.27, 0.28];
/** The sign of a turn around the body's side axis that lifts the tail. */
const TAIL_UP = 1;
/** The sign of a turn around the body's side axis that lifts a bone's far end (the arch's rise). */
const ARCH_UP = -1;

type Property = "rotationQuaternion" | "position" | "scaling";
type Leg = "lh" | "rh" | "lf" | "rf";
/** One animated property of one node, with its animation in each clip (or null), and the leg it
 * moves, if any. */
type Channel = {
  node: TransformNode;
  property: Property;
  clips: (Animation | null)[];
  leg: Leg | null;
};
/** Each leg's top bone (everything under it is that leg), and the bone whose position is its foot. */
const LEGS: Record<Leg, { top: string; foot: string }> = {
  lh: { top: "Bip01 L Thigh", foot: "Bip01 L Toe0" },
  rh: { top: "Bip01 R Thigh", foot: "Bip01 R Toe0" },
  lf: { top: "Bip01 L Clavicle", foot: "Bip01 L Finger0" },
  rf: { top: "Bip01 R Clavicle", foot: "Bip01 R Finger0" },
};
/** The run clip's index in blend order (the idle, walk, trot, run). */
const RUN = 3;

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
  const spine = bone(BONES.spine);
  const chest = bone(BONES.chest);
  const spine2 = bone(BONES.spine2);
  const neck = bone(BONES.neck);
  const head = bone(BONES.head);
  const tailBones = BONES.tail.map(bone);
  /** A swiping leg's bones, and the trail that follows its paw tip. */
  const leg = (names: readonly string[]) => {
    const [shoulder, upperArm, forearm, tip] = names.map(bone) as [
      TransformNode,
      TransformNode,
      TransformNode,
      TransformNode,
    ];
    return { shoulder, upperArm, forearm, trail: createSwipeTrail(scene, tip) };
  };
  const paws = { right: leg(BONES.rightPaw), left: leg(BONES.leftPaw) };
  /** The hind legs for the swipe's footwork, and where each foot stood (in the root's frame) when
   * the attack being played started. */
  const hindLegs = (["L", "R"] as const).map((s) => ({
    thigh: bone(`Bip01 ${s} Thigh`),
    calf: bone(`Bip01 ${s} Calf`),
    foot: bone(`Bip01 ${s} Toe0`),
    rest: new Vector3(),
  }));
  let plantedFor: object | null = null;
  const rootInverse = new Matrix();
  const footTarget = new Vector3();

  // Clips in blend order: the idle, then the gaits.
  const clipNames = [IDLE_CLIP, ...GAIT_CLIPS.map((clip) => clip.name)];
  const channels = collectChannels(entries, clipNames);
  const durations = clipNames.map((name) => {
    const group = entries.animationGroups.find((g) => g.name === name);
    return group ? (group.to - group.from) / 60 : 1;
  });
  const feet = Object.fromEntries(
    Object.entries(LEGS).map(([leg, { foot }]) => [leg, bone(foot)]),
  ) as Record<Leg, TransformNode>;

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
  /** Simulation time at the end of the last tick seen (the view time that shows it), and the
   * auto attack being played: when its cast started and its windup, in that time. */
  let tickTime = 0;
  let casts: number | null = null;
  /** The auto attack being played: when its cast started and its windup (view time), when it was
   * called off (or null), and the paw: 1 = right, -1 = left. */
  let attack: {
    start: number;
    windup: number;
    cancelled: number | null;
    side: 1 | -1;
  } | null = null;

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
  /** The smoothed turn rate driving the tail, and the tail's chains (one spring per bone): side
   * to side, and up and down. */
  const tailTurn: Spring = { value: 0, velocity: 0 };
  const tail: Spring[] = BONES.tail.map(() => ({ value: 0, velocity: 0 }));
  const tailPitch: Spring[] = BONES.tail.map(() => ({ value: 0, velocity: 0 }));
  let time = 0;
  const look: Spring = { value: 0, velocity: 0 };
  const snap = () => {
    smoothSpeed = gaitSpeed;
    brake = 0;
    pushTime = Number.POSITIVE_INFINITY;
    const springs = [
      lean,
      tilt,
      settle,
      tailTurn,
      ...tail,
      ...tailPitch,
      look,
      bend.front,
      bend.hips,
    ];
    for (const spring of springs) {
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

  // The run's legs are each sampled a little ahead or behind (the bound), and the body's motion and
  // the stop points follow from that pose. Worked out at load and when `anim.bound` changes.
  const legShift: Record<Leg, number> = { lh: 0, rh: 0, lf: 0, rf: 0 };
  let contacts: Record<Leg, number> | null = null;
  let motion: StrideMotion = { lift: [0], rock: [0], gather: [0] };
  let stopScores: number[][] = [];
  let analysedBound: number | null = null;

  /** A channel's time in clip `i` at the shared stride `phase`. */
  const timeOf = (channel: Channel, i: number, phase: number) => {
    if (i === 0) return 0;
    const clip = GAIT_CLIPS[i - 1] as (typeof GAIT_CLIPS)[number];
    const shift = i === RUN && channel.leg ? legShift[channel.leg] : 0;
    return clipTime(phase + shift, clip.offset, durations[i] as number);
  };

  /** Blends the clips into the bones: `weights` per clip in `clipNames` order, at the stride `phase`. */
  const applyPose = (weights: number[], phase: number) => {
    for (const channel of channels) {
      let total = 0;
      if (channel.property === "rotationQuaternion") {
        pose.set(0, 0, 0, 0);
        channel.clips.forEach((animation, i) => {
          const weight = weights[i] as number;
          if (!animation || weight <= 0) return;
          const at = timeOf(channel, i, phase);
          sampled.copyFrom(animation.evaluate(at * animation.framePerSecond));
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
          const at = timeOf(channel, i, phase);
          const value = animation.evaluate(at * animation.framePerSecond) as Vector3;
          vector.addInPlace(value.scale(weight));
          total += weight;
        });
        if (total <= 0) continue;
        channel.node[channel.property].copyFrom(vector.scaleInPlace(1 / total));
      }
    }
  };

  /** Where the run's feet are over a stride, in the model's own space (cm, forward is −X). */
  const trackFeet = (): StrideFeet => {
    const tracks = {} as Record<Leg, FootTrack>;
    for (const leg of Object.keys(LEGS) as Leg[]) tracks[leg] = { height: [], forward: [] };
    const runOnly = clipNames.map((_, i) => (i === RUN ? 1 : 0));
    const inverse = new Matrix();
    const local = new Vector3();
    for (let k = 0; k < STRIDE_SAMPLES; k++) {
      applyPose(runOnly, k / STRIDE_SAMPLES);
      refreshWorld(rig);
      rig.getWorldMatrix().invertToRef(inverse);
      for (const leg of Object.keys(LEGS) as Leg[]) {
        refreshWorld(feet[leg]);
        Vector3.TransformCoordinatesToRef(feet[leg].getAbsolutePosition(), inverse, local);
        tracks[leg].height.push(local.y);
        tracks[leg].forward.push(-local.x);
      }
    }
    return tracks;
  };

  /** For each gait, how far its pose is from the idle's over a stride: the summed angle between
   * the bones' rotations. A stop strides on to a low point, where the legs are nearly standing. */
  const scoreStops = (): number[][] => {
    const a = new Quaternion();
    const b = new Quaternion();
    return GAIT_CLIPS.map((_, g) =>
      Array.from({ length: STRIDE_SAMPLES }, (_, k) => {
        let total = 0;
        for (const channel of channels) {
          if (channel.property !== "rotationQuaternion") continue;
          const idle = channel.clips[0];
          const gait = channel.clips[g + 1];
          if (!idle || !gait) continue;
          a.copyFrom(idle.evaluate(0));
          const at = timeOf(channel, g + 1, k / STRIDE_SAMPLES);
          b.copyFrom(gait.evaluate(at * gait.framePerSecond));
          total += 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(a, b))));
        }
        return total;
      }),
    );
  };

  const analyse = () => {
    analysedBound = ANIM.bound;
    if (!contacts) {
      for (const leg of Object.keys(legShift) as Leg[]) legShift[leg] = 0;
      const raw = trackFeet();
      contacts = {
        lh: contactPhase(raw.lh.height),
        rh: contactPhase(raw.rh.height),
        lf: contactPhase(raw.lf.height),
        rf: contactPhase(raw.rf.height),
      };
    }
    const hind = pairShift(contacts.lh, contacts.rh, ANIM.bound);
    const front = pairShift(contacts.lf, contacts.rf, ANIM.bound);
    Object.assign(legShift, { lh: hind.left, rh: hind.right, lf: front.left, rf: front.right });
    motion = strideMotion(trackFeet());
    stopScores = scoreStops();
  };

  const up = Vector3.Up();
  const side = new Vector3();

  return {
    root,

    tick(player, input) {
      tickTime += TICK_DT;
      // A new auto attack: it started `elapsed` before the end of this tick.
      const caster = player.caster;
      if (caster && casts !== null && caster.casts !== casts && caster.cast?.slot === "primary") {
        const def = abilityById(caster.cast.ability);
        const windup = def ? def.stats(player).windup : 0;
        attack = {
          start: tickTime - caster.cast.elapsed,
          windup,
          cancelled: null,
          side: swipeSide(caster.casts),
        };
      } else if (
        attack &&
        attack.cancelled === null &&
        caster?.cast?.slot !== "primary" &&
        tickTime - attack.start < attack.windup - 1e-6
      ) {
        // Called off before the hit (a move order): it fades out from where it is.
        attack.cancelled = tickTime;
      }
      casts = caster?.casts ?? null;
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
      if (analysedBound !== ANIM.bound) analyse();
      applyPose(driver.weights, phase);
      // The gallop's own body motion, as much as the gallop shows.
      const galloping = driver.weights[RUN] as number;
      // Up from where the landings are, never below: the feet don't sink into the floor.
      const lowest = Math.min(...motion.lift);
      const lift = ((sampleLoop(motion.lift, phase) - lowest) / (1 - lowest || 1)) * galloping;
      const rock = sampleLoop(motion.rock, phase) * galloping;
      const gather = sampleLoop(motion.gather, phase) * galloping;

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

      // The swipe: where it is, and how far the body sits back, lunges and pitches into it.
      const swipe = attack
        ? swipePhase(
            viewTime - attack.start,
            attack.windup,
            SWIPE.follow,
            SWIPE.cock,
            attack.cancelled === null ? null : viewTime - attack.cancelled,
            SWIPE.fade,
            SWIPE.through,
          )
        : null;
      const swiping = swipe && swipe.weight > 0 ? swipe : null;
      const weight = swiping?.weight ?? 0;
      // How wound up it is (back to 0 by the hit), how far into the strike (held until it eases
      // back), and how far it's carried on past the hit.
      const wound = swiping ? weight * swiping.cock * (1 - swiping.strike) : 0;
      const struck = swiping ? weight * swiping.strike * (1 - swiping.release) : 0;
      const carried = swiping ? weight * swiping.through * (1 - swiping.release) : 0;
      const lunge = -SWIPE.windBack * wound + SWIPE.lunge * struck;
      // Nose down in the coil, then up as the body stretches into the hit. Only `bodyPitch` of it
      // tilts the whole body (the rest bends the spine below), so the back curves instead of
      // tipping like a plank.
      const rearing = (SWIPE.coil * wound - SWIPE.rear * struck) * DEG;
      const swipePitch = rearing * SWIPE.bodyPitch;
      // How far the front half is turned toward the paw's side (wound) or with the swing past the
      // target (carried): bent through the spine, the hips swinging back against it.
      const swipeYaw = (attack?.side ?? 1) * (SWIPE.turn + SWIPE.twist) * (wound - carried) * DEG;

      body.position.y =
        pivot +
        (lift * ANIM.bounce - push * ANIM.pushOffDip - SWIPE.crouch * wound + SWIPE.rise * struck) *
          scale;
      body.position.z = lunge * scale;
      body.rotation.set(
        swipePitch + tilt.value + settle.value + (push * ANIM.pushOff - rock * ANIM.rock) * DEG,
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
      // The back's arch: the mid-back rises from the hips and falls to the shoulders (an upside-
      // down V peaking at Spine2), and the neck gives it back so the head and front legs keep
      // their angle. The hind legs hang off the lower spine, so they stay as the clip has them.
      const arch = (gather >= 0 ? gather : gather * ANIM.stretch) * ANIM.flex * DEG * ARCH_UP;
      rotateAroundWorld(chest, side, arch);
      rotateAroundWorld(spine2, side, -2 * arch);
      rotateAroundWorld(neck, side, arch);

      const lookTarget = ANIM.headLook
        ? lookYaw(root.position, facing + bend.front.value, aim, ANIM.headMax * DEG)
        : 0;
      stepSpring(look, lookTarget, ANIM.headFrequency, 1, step);
      rotateAroundWorld(neck, up, look.value * (LOOK_SHARE[0] as number));
      rotateAroundWorld(head, up, look.value * (LOOK_SHARE[1] as number));

      // The swiping paw: drawn up and out, then reaching forward and across into the hit. The
      // shoulder turns the whole leg (the sweep), the upper arm raises it forward, the forearm
      // curls back while cocked and snaps straight in the strike.
      if (swiping) {
        // The spine carries the swing: the hips (and the hind legs and tail on them) swing back
        // a share of it, the front turns the rest, spread from the mid back to the neck. A cat
        // shifting its weight, not a plank on a pivot.
        const hips = -SWIPE.hips * swipeYaw;
        const front = swipeYaw - hips;
        rotateAroundWorld(spine, up, hips);
        rotateAroundWorld(chest, up, front * 0.45);
        rotateAroundWorld(spine2, up, front * 0.35);
        rotateAroundWorld(neck, up, front * 0.2);
        // The rest of the rear-up and pounce bends the back: the chest and upper back lift (or
        // drop), the hips stay with the ground.
        const bendPitch = rearing * (1 - SWIPE.bodyPitch);
        rotateAroundWorld(chest, side, bendPitch * 0.55);
        rotateAroundWorld(spine2, side, bendPitch * 0.45);
      }
      if (swiping && attack) {
        const { shoulder, upperArm, forearm } = attack.side === 1 ? paws.right : paws.left;
        // Far out to its own side, back to the middle (the target) on the hit, then on past the
        // other side: mirrored for the left paw.
        const sweep = attack.side * (SWIPE.out * wound - SWIPE.across * carried) * DEG;
        const raise = (SWIPE.lift * wound + SWIPE.reach * struck) * DEG;
        side.set(Math.cos(facing), 0, -Math.sin(facing));
        rotateAroundWorld(shoulder, up, sweep);
        // A turn around the side axis by a negative angle swings a hanging limb forward.
        rotateAroundWorld(upperArm, side, -raise);
        rotateAroundWorld(forearm, side, SWIPE.curl * wound * DEG);
        // The head draws back with the coil and goes with the body into the hit.
        rotateAroundWorld(neck, side, SWIPE.dip * wound * DEG);
        // Through the coil the eyes stay on the target (the head turns back against the front's
        // wind); after the hit the head follows the paw through.
        const windYaw = attack.side * (SWIPE.turn + SWIPE.twist) * wound * DEG;
        const followYaw = -attack.side * SWIPE.across * carried * DEG;
        rotateAroundWorld(neck, up, -windYaw * SWIPE.eyes * 0.5);
        rotateAroundWorld(head, up, -windYaw * SWIPE.eyes * 0.5 + followYaw * SWIPE.look);
      }
      // The hind feet: planted while the body coils and pushes off (the legs load, then extend
      // behind it), then a hop: off the ground and forward with the lunge, landing as it settles.
      if (swiping && attack && SWIPE.hindLegs) {
        root.computeWorldMatrix(true);
        root.getWorldMatrix().invertToRef(rootInverse);
        if (plantedFor !== attack) {
          plantedFor = attack;
          for (const legBones of hindLegs) {
            refreshWorld(legBones.foot);
            Vector3.TransformCoordinatesToRef(
              legBones.foot.getAbsolutePosition(),
              rootInverse,
              legBones.rest,
            );
          }
        }
        const from = Math.min(0.99, SWIPE.hopFrom);
        const late = Math.max(0, Math.min(1, (swiping.strike - from) / (1 - from)));
        const hop = late * late * (3 - 2 * late) * (1 - swiping.release);
        for (const legBones of hindLegs) {
          footTarget.set(
            legBones.rest.x,
            legBones.rest.y + SWIPE.hop * scale * hop,
            legBones.rest.z + lunge * scale * hop,
          );
          Vector3.TransformCoordinatesToRef(footTarget, root.getWorldMatrix(), footTarget);
          reachFoot(legBones.thigh, legBones.calf, legBones.foot, footTarget, side, weight);
        }
      }

      // The trail streams off the striking paw from the strike through the swing past the target.
      const trailing =
        !!swiping && SWIPE.trail && swiping.strike > 0 && swiping.release < 0.3 && !!attack;
      paws.right.trail.update(trailing && attack?.side === 1, step);
      paws.left.trail.update(trailing && attack?.side === -1, step);

      // The tail is never still. Two whip-like chains (side to side, up and down) follow:
      // - standing: a slow random wander, a wandering lift and tip curl, and now and then a
      //   bigger swing to one side;
      // - moving: a swing in time with the stride, a faster wander on top, carried higher;
      // - always: swinging out of turns.
      // The randomness is smooth noise of the view's time, so it pauses, steps and replays.
      const moving01 = 1 - idle;
      stepSpring(tailTurn, turnRate, ANIM.tailDrive, 1, step);
      const turning = -tailTurn.value * ANIM.tail;
      const flickOptions = {
        every: ANIM.tailFlickEvery,
        chance: ANIM.tailFlickChance,
        length: ANIM.tailFlickTime,
      };
      const standing =
        noise(time * ANIM.tailSwayRate, 11) * ANIM.tailSway +
        flicks(time, 23, flickOptions) * ANIM.tailFlick;
      const striding =
        Math.sin(2 * Math.PI * phase) * ANIM.tailStride +
        noise(time * ANIM.tailRunRate, 37) * ANIM.tailRunSway;
      // In a swipe the tail whips against the front's swing and lifts while it winds.
      const swipeTail = swiping ? -(swipeYaw / DEG) * SWIPE.tailWhip : 0;
      const swing = turning + standing * idle + striding * moving01 + swipeTail;
      const drive = Math.max(-ANIM.tailMax, Math.min(ANIM.tailMax, swing)) * DEG;
      stepChain(tail, drive, ANIM.tailFrequency, ANIM.tailDamping, step);
      const lifting =
        noise(time * ANIM.tailSwayRate * 0.6, 53) * ANIM.tailLift * idle +
        (ANIM.tailRunLift + noise(time * ANIM.tailRunRate, 61) * ANIM.tailLift * 0.5) * moving01 +
        SWIPE.tailLift * (wound + struck);
      stepChain(tailPitch, lifting * DEG, ANIM.tailFrequency, ANIM.tailDamping, step);
      // The tip curls on its own (a cat's hook), more while standing.
      const curl =
        noise(time * ANIM.tailSwayRate * 0.8, 71) * ANIM.tailCurl * (0.4 + 0.6 * idle) * DEG;
      side.set(Math.cos(facing), 0, -Math.sin(facing));
      tailBones.forEach((node, i) => {
        const share = TAIL_SHARE[i] as number;
        rotateAroundWorld(node, up, (tail[i]?.value ?? 0) * share);
        const tip = i >= 2 ? curl * (i - 1) * 0.5 : 0;
        rotateAroundWorld(node, side, ((tailPitch[i]?.value ?? 0) * share + tip) * TAIL_UP);
      });
    },

    dispose() {
      paws.right.trail.dispose();
      paws.left.trail.dispose();
      entries.dispose();
      rig.dispose();
      body.dispose();
      root.dispose();
    },
  };
}

/** sRGB: the swipe trail, hot orange. */
const TRAIL_COLOR = Color3.FromHexString("#ffa646");
/** Seconds the trail takes to fade once the paw has struck. */
const TRAIL_FADE = 0.15;

/**
 * A glowing ribbon behind a paw tip while it strikes (Babylon's TrailMesh, following a node on the
 * tip bone; additive, unlit and unfogged, so bloom picks it up). `update(active, step)` every frame:
 * it starts fresh when a strike starts, fades out over `TRAIL_FADE` after, and holds still while
 * paused.
 */
function createSwipeTrail(scene: Scene, tip: TransformNode) {
  // Not parented to the tip: the rig is scaled to centimeters, and the trail takes its width from
  // the generator's world scale. It's moved onto the tip every frame instead.
  const generator = new TransformNode("swipeTrailTip", scene);
  const trail = new TrailMesh("swipeTrail", generator, scene, {
    diameter: 0.12,
    length: 14,
    sections: 4,
    autoStart: false,
  });
  const material = new StandardMaterial("swipeTrail", scene);
  material.disableLighting = true;
  // Brighter than white-hot so the bloom catches it.
  material.emissiveColor = TRAIL_COLOR.toLinearSpace().scale(2.5);
  material.alphaMode = Constants.ALPHA_ADD;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.fogEnabled = false;
  trail.material = material;
  trail.isPickable = false;
  trail.setEnabled(false);
  let running = false;
  let fade = 0;
  return {
    update(active: boolean, step: number): void {
      refreshWorld(tip);
      generator.position.copyFrom(tip.getAbsolutePosition());
      if (active && !running) {
        trail.reset();
        trail.start();
        trail.setEnabled(true);
        running = true;
        fade = 1;
      } else if (!active && running) {
        trail.stop();
        running = false;
      }
      // Frozen while the view time stands still (paused), like everything else.
      if (running) {
        if (step > 0) trail.start();
        else trail.stop();
      }
      if (!running && fade > 0) {
        fade = Math.max(0, fade - step / TRAIL_FADE);
        if (fade === 0) trail.setEnabled(false);
      }
      material.alpha = fade;
    },
    dispose(): void {
      trail.dispose();
      material.dispose();
      generator.dispose();
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
        channel = { node: target, property, clips: clipNames.map(() => null), leg: legOf(target) };
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

const ikHip = new Vector3();
const ikFoot = new Vector3();
const ikA = new Vector3();
const ikB = new Vector3();

/**
 * Two-bone reach for a hind leg (a little IK for the swipe's footwork): folds the knee (the thigh
 * one way, the calf twice the other) until the foot is as far from the hip as `target`, then swings
 * the thigh around `side` (the body's side axis) to point the foot at it. `amount` blends from the
 * pose the clips gave (0) to reaching the target (1). Solved numerically (a few secant steps), so
 * the bones' own axes and the rig's mirroring don't matter.
 */
function reachFoot(
  thigh: TransformNode,
  calf: TransformNode,
  foot: TransformNode,
  target: Vector3,
  side: Vector3,
  amount: number,
): void {
  if (amount <= 0) return;
  const footNow = () => {
    refreshWorld(foot);
    return ikFoot.copyFrom(foot.getAbsolutePosition());
  };
  refreshWorld(thigh);
  ikHip.copyFrom(thigh.getAbsolutePosition());
  // Blend the goal from where the foot is now.
  const start = footNow().clone();
  const goal = start.add(target.subtract(start).scale(Math.min(1, amount)));
  const want = Vector3.Distance(goal, ikHip);

  // The knee: find the fold whose hip-to-foot distance is `want`.
  let fold = 0;
  let distance = Vector3.Distance(footNow(), ikHip);
  const applyFold = (delta: number) => {
    rotateAroundWorld(thigh, side, delta);
    rotateAroundWorld(calf, side, -2 * delta);
  };
  let probe = 0.15;
  for (let i = 0; i < 4 && Math.abs(distance - want) > 0.002; i++) {
    applyFold(probe);
    const next = Vector3.Distance(footNow(), ikHip);
    const slope = (next - distance) / probe;
    fold += probe;
    distance = next;
    if (Math.abs(slope) < 1e-4) break;
    const step = Math.max(-0.5, Math.min(0.5, (want - distance) / slope));
    // Stay within a sane bend either way.
    probe = Math.max(-0.7, Math.min(1.1, fold + step)) - fold;
  }

  // The swing: turn the thigh around the side axis so the foot points at the goal.
  const toFoot = ikA.copyFrom(footNow()).subtractInPlace(ikHip);
  const toGoal = ikB.copyFrom(goal).subtractInPlace(ikHip);
  toFoot.subtractInPlace(side.scale(Vector3.Dot(toFoot, side)));
  toGoal.subtractInPlace(side.scale(Vector3.Dot(toGoal, side)));
  if (toFoot.lengthSquared() < 1e-8 || toGoal.lengthSquared() < 1e-8) return;
  const angle = Math.acos(
    Math.max(-1, Math.min(1, Vector3.Dot(toFoot.normalize(), toGoal.normalize()))),
  );
  if (angle < 1e-4) return;
  const before = Vector3.Distance(footNow(), goal);
  rotateAroundWorld(thigh, side, angle);
  // Wrong way round: turn back past the start.
  if (Vector3.Distance(footNow(), goal) > before) rotateAroundWorld(thigh, side, -2 * angle);
}

/** Recomputes the world matrices from the top of `node`'s chain down, so they're current. */
function refreshWorld(node: Node | null): void {
  if (!node) return;
  refreshWorld(node.parent);
  if (node instanceof TransformNode) node.computeWorldMatrix(true);
}

/** The leg a bone belongs to (it's the leg's top bone or under it), or null. */
function legOf(node: Node): Leg | null {
  for (let at: Node | null = node; at; at = at.parent) {
    for (const [leg, { top }] of Object.entries(LEGS) as [Leg, { top: string }][]) {
      if (at.name === top || at.name.startsWith(`${top}_`)) return leg;
    }
  }
  return null;
}
