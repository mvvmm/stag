import { Constants, type Mesh } from "@babylonjs/core";
import { areaShape } from "@/combat/abilities";
import { TICK_DT } from "@/core/constants";
import { abilityById } from "@/data/abilities";
import type { Cast, Entity } from "@/ecs/world";
import { buildAreaMesh, flatMaterial, placeArea } from "@/render/areaMesh";
import type { SceneContext } from "@/scenes/scene";

// The grey-box flash of an ability's areas where its effects land (2.3): for every caster's
// non-primary casts (the auto attack has its own hit fx), a short additive flash in the overlay
// scene, fading on the view's time so pause, frame steps and replay seeks show it right. It only
// reads the world: after each tick it compares each caster's cast with the one it saw last tick.

/** sRGB. */
const COLOR = "#e6eeff";
const FILL_ALPHA = 0.45;
const LINE_WIDTH = 0.08;
/** How long a flash shows, s (view time). */
const LIFE = 0.25;
/** Float slack, as in `systems/casting.ts`. */
const EPSILON = 1e-9;

type Seen = { cast: Cast; casts: number };
type Flash = { mesh: Mesh; born: number };

export function createCastFx(ctx: SceneContext) {
  const { world, overlay: scene } = ctx;
  const materials = {
    fill: ctx.own(flatMaterial("castFlashFill", scene, COLOR, FILL_ALPHA)),
    line: ctx.own(flatMaterial("castFlashLine", scene, COLOR, 1)),
  };
  materials.fill.alphaMode = Constants.ALPHA_ADD;
  materials.line.alphaMode = Constants.ALPHA_ADD;
  const flashes = new Set<Flash>();
  ctx.onDispose(() => {
    for (const flash of flashes) flash.mesh.dispose();
  });
  const seen = new Map<Entity, Seen>();

  /** Flashes the areas of `cast` by `entity`, where they land now. */
  const flash = (entity: Entity, cast: Cast) => {
    const def = abilityById(cast.ability);
    if (!def) return;
    const born = ctx.viewTime();
    for (const effect of def.stats(entity).effects) {
      if (!effect.area) continue;
      const shape = areaShape(entity, cast.aim, effect.area);
      if (!shape) continue;
      const mesh = buildAreaMesh("castFlash", scene, effect.area, materials, LINE_WIDTH);
      const at = shape.kind === "circle" ? shape.center : shape.origin;
      const dir = shape.kind === "circle" ? { x: 0, z: 1 } : shape.dir;
      placeArea(mesh, effect.area, at, dir, at);
      flashes.add({ mesh, born });
    }
  };

  // The sim applies effects at the end of a windup (or a channel's pulses), then ends the cast or
  // starts the next one in the same tick, so a landing shows as the cast that was there last tick
  // having reached its time. Instant casts (no windup) start and land within one tick unseen.
  ctx.onTick(() => {
    for (const entity of world.with("caster")) {
      const { caster } = entity;
      const before = seen.get(entity);
      const now = caster.cast;
      if (before && before.cast.slot !== "primary") {
        const same = now !== null && caster.casts === before.casts;
        const prev = before.cast;
        const def = abilityById(prev.ability);
        const stats = def?.stats(entity);
        const elapsed = prev.elapsed + TICK_DT + EPSILON;
        if (stats && prev.phase === "windup") {
          // A windup that ran its length: the effects landed, unless a channel starts.
          const over = !same || now?.phase !== "windup";
          if (over && !stats.channel && elapsed >= stats.windup) flash(entity, prev);
          // A channel's first pulses can come in the tick its windup ends.
          if (same && now?.phase === "channel" && now.pulses > 0) flash(entity, now);
        } else if (stats?.channel && prev.phase === "channel") {
          const pulses = same && now ? now.pulses : Math.floor(elapsed / stats.channel.interval);
          if (pulses > prev.pulses) flash(entity, now ?? prev);
        }
      }
      if (now) seen.set(entity, { cast: structuredClone(now), casts: caster.casts });
      else seen.delete(entity);
    }
  });

  ctx.onBeforeRender(() => {
    const time = ctx.viewTime();
    for (const flash of flashes) {
      const age = time - flash.born;
      if (age > LIFE || age < -LIFE) {
        flash.mesh.dispose();
        flashes.delete(flash);
        continue;
      }
      // Not shown before it was born (a replay seek went back); bright at once, then fading.
      const t = Math.max(0, age) / LIFE;
      const visibility = age < 0 ? 0 : (1 - t) * (1 - t);
      flash.mesh.visibility = visibility;
      for (const child of flash.mesh.getChildMeshes()) child.visibility = visibility;
    }
  });
}
