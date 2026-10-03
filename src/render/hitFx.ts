import {
  Constants,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import type { Disposable } from "@/core/disposer";

// The auto attack's impact (2.2): where the paw meets the body, a bright starburst flashes and
// three claw scratches rip across it, then both fade. Like League's hit sparks, it's what makes a
// hit read from the top-down camera. In the overlay scene (true colors, never fogged), additive,
// a fixed pool of effects animated on the view's time, so pause, frame step and seeks show them.

/** How many impacts can show at once. */
const POOL = 8;
/** The starburst: size (m), how long it shows (s), and the scale it pops from and to. */
const BURST_SIZE = 1.6;
const BURST_LIFE = 0.18;
/** The scratches: size of the plane they're drawn on (m), how long they take to rip across (s),
 * and how long they show in all (s). */
const SLASH_SIZE = 1.25;
const SLASH_DRAW = 0.05;
const SLASH_LIFE = 0.3;

type Slot = {
  root: TransformNode;
  burst: Mesh;
  slash: Mesh;
  born: number;
};

/** What the scene setup owns: everything built here is disposed with it. */
type Owner = { own<T extends Disposable>(thing: T): T };

/**
 * The impact effects. `spawn` one where a hit lands (a world point), with the side the paw swept
 * from (1: from the cat's right, -1: from its left) so the scratches run the way the paw went, and
 * a seed for the little variations; call `update` every frame with the view time.
 */
export function createHitFx(ctx: Owner, scene: Scene) {
  const burstTexture = ctx.own(drawBurst(scene));
  const slashTexture = ctx.own(drawSlashes(scene));
  const material = (name: string, texture: DynamicTexture) => {
    const m = ctx.own(new StandardMaterial(name, scene));
    m.disableLighting = true;
    m.emissiveTexture = texture;
    m.opacityTexture = texture;
    m.alphaMode = Constants.ALPHA_ADD;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    return m;
  };
  const burstMaterial = material("hitBurst", burstTexture);
  const slashMaterial = material("hitSlash", slashTexture);

  const slots: Slot[] = [];
  for (let i = 0; i < POOL; i++) {
    const root = ctx.own(new TransformNode(`hitFx-${i}`, scene));
    root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const burst = ctx.own(MeshBuilder.CreatePlane(`hitBurst-${i}`, { size: BURST_SIZE }, scene));
    burst.material = burstMaterial;
    burst.parent = root;
    burst.isPickable = false;
    const slash = ctx.own(MeshBuilder.CreatePlane(`hitSlash-${i}`, { size: SLASH_SIZE }, scene));
    slash.material = slashMaterial;
    slash.parent = root;
    slash.isPickable = false;
    root.setEnabled(false);
    slots.push({ root, burst, slash, born: Number.NEGATIVE_INFINITY });
  }
  let next = 0;

  return {
    spawn(at: { x: number; y: number; z: number }, side: number, seed: number, time: number) {
      const slot = slots[next++ % POOL] as Slot;
      slot.born = time;
      slot.root.position.set(at.x, at.y, at.z);
      // The scratches run diagonally the way the paw went (mirrored for the other paw), tilted a
      // little differently every hit; the burst's spikes turn too.
      const jitter = ((seed % 7) - 3) * 0.07;
      slot.slash.rotation.z = side * (0.55 + jitter);
      slot.slash.scaling.x = side;
      slot.burst.rotation.z = (seed % 11) * 0.29;
    },
    update(time: number) {
      for (const slot of slots) {
        const age = time - slot.born;
        const alive = age >= 0 && age < SLASH_LIFE;
        slot.root.setEnabled(alive);
        if (!alive) continue;
        // The burst pops big and fades fast.
        const b = age / BURST_LIFE;
        slot.burst.setEnabled(b < 1);
        if (b < 1) {
          slot.burst.scaling.setAll(0.55 + 0.75 * Math.sqrt(b));
          slot.burst.visibility = (1 - b) * (1 - b);
        }
        // The scratches rip across (grow along their length), hold, then fade.
        const draw = Math.min(1, age / SLASH_DRAW);
        slot.slash.scaling.y = 0.25 + 0.75 * draw;
        const fadeFrom = SLASH_LIFE * 0.4;
        slot.slash.visibility = age < fadeFrom ? 1 : 1 - (age - fadeFrom) / (SLASH_LIFE - fadeFrom);
      }
    },
  };
}

/** A starburst: a hot core and sharp uneven spikes, white-yellow into orange. */
function drawBurst(scene: Scene): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture("hitBurst", { width: size, height: size }, scene, true);
  const g = texture.getContext() as unknown as CanvasRenderingContext2D;
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const glow = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
  glow.addColorStop(0, "rgba(255, 250, 225, 1)");
  glow.addColorStop(0.35, "rgba(255, 200, 90, 0.9)");
  glow.addColorStop(1, "rgba(255, 120, 30, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const spikes = 9;
  for (let i = 0; i < spikes; i++) {
    const angle = (i / spikes) * Math.PI * 2 + (i % 2) * 0.17;
    const length = c * (i % 3 === 0 ? 0.98 : i % 3 === 1 ? 0.72 : 0.55);
    const width = 0.09 + (i % 2) * 0.04;
    const grad = g.createLinearGradient(
      c,
      c,
      c + Math.cos(angle) * length,
      c + Math.sin(angle) * length,
    );
    grad.addColorStop(0, "rgba(255, 252, 235, 1)");
    grad.addColorStop(0.5, "rgba(255, 196, 80, 0.85)");
    grad.addColorStop(1, "rgba(255, 110, 20, 0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(c + Math.cos(angle - width) * 14, c + Math.sin(angle - width) * 14);
    g.lineTo(c + Math.cos(angle) * length, c + Math.sin(angle) * length);
    g.lineTo(c + Math.cos(angle + width) * 14, c + Math.sin(angle + width) * 14);
    g.closePath();
    g.fill();
  }
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/** Three claw scratches side by side: thin curved strokes, tapered at both ends, hot in the middle. */
function drawSlashes(scene: Scene): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture("hitSlash", { width: size, height: size }, scene, true);
  const g = texture.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, size, size);
  g.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const x = size * (0.33 + i * 0.17);
    const top = size * (0.1 + i * 0.03);
    const bottom = size * (0.9 - (2 - i) * 0.03);
    // A tapered stroke: several passes, wide and dim to thin and bright.
    for (const [width, color] of [
      [16, "rgba(255, 120, 30, 0.35)"],
      [9, "rgba(255, 190, 80, 0.8)"],
      [4, "rgba(255, 250, 230, 1)"],
    ] as const) {
      const grad = g.createLinearGradient(x, top, x, bottom);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(0.4, color);
      grad.addColorStop(0.6, color);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.strokeStyle = grad;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x - 18, top);
      g.quadraticCurveTo(x + 22, size / 2, x - 10, bottom);
      g.stroke();
    }
  }
  texture.hasAlpha = true;
  texture.update();
  return texture;
}
