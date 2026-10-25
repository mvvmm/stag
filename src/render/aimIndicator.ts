import type { Mesh } from "@babylonjs/core";
import type { Vec2 } from "@/core/math";
import { type Area, abilityById } from "@/data/abilities";
import type { Entity } from "@/ecs/world";
import { areaKey, buildAreaMesh, flatMaterial, placeArea } from "@/render/areaMesh";
import { createRangeRing } from "@/render/rangeRing";
import type { SceneContext } from "@/scenes/scene";
import { movementStats } from "@/systems/movementStats";

// The normal cast's indicator (2.3), League-style grey-box: while `player.aiming` is set (Shift +
// an ability key, until a left click confirms it or something cancels it), the range ring round
// the player and the ability's areas where they'd land at the cursor. In the overlay scene, pale
// and flat; it follows the cursor every frame. A `target` aim shows only the ring: the hover glow
// marks the enemy, the attack cursor the aim.

/** sRGB: pale blue-white, like the range ring. */
const COLOR = "#cfe0f5";
const FILL_ALPHA = 0.16;
const LINE_ALPHA = 0.85;
const LINE_WIDTH = 0.05;

type PlayerEntity = Entity & Required<Pick<Entity, "player" | "transform">>;

/**
 * Builds the indicator for `player`; call `update` every frame (before render) with where the
 * player's body is drawn (its interpolated mesh), so the indicator doesn't lag it.
 */
export function createAimIndicator(ctx: SceneContext, player: PlayerEntity) {
  const scene = ctx.overlay;
  const ring = createRangeRing(scene);
  ctx.onDispose(() => ring.dispose());
  const materials = {
    fill: ctx.own(flatMaterial("aimFill", scene, COLOR, FILL_ALPHA)),
    line: ctx.own(flatMaterial("aimLine", scene, COLOR, LINE_ALPHA)),
  };
  // One mesh per area of the aimed ability, rebuilt when its numbers change.
  const shapes: { key: string; mesh: Mesh }[] = [];
  ctx.onDispose(() => {
    for (const shape of shapes) shape.mesh.dispose();
  });
  const shapeFor = (index: number, area: Area): Mesh => {
    const key = areaKey(area);
    const shape = shapes[index];
    if (shape?.key === key) return shape.mesh;
    shape?.mesh.dispose();
    const mesh = buildAreaMesh(`aim${index}`, scene, area, materials, LINE_WIDTH);
    shapes[index] = { key, mesh };
    return mesh;
  };

  return {
    update(at: Vec2): void {
      const slot = player.player.aiming?.slot;
      const state = slot ? player.caster?.slots[slot] : undefined;
      const def = state ? abilityById(state.ability) : undefined;
      let shown = 0;
      if (!def || def.aim === "self") {
        ring.show(null);
      } else {
        const stats = def.stats(player);
        const areas = stats.effects.flatMap((effect) => (effect.area ? [effect.area] : []));
        const cursor = ctx.input.aim;
        const dx = cursor.x - at.x;
        const dz = cursor.z - at.z;
        const d = Math.hypot(dx, dz);
        const facing = player.transform.rotation.y;
        const dir =
          d > 1e-6 ? { x: dx / d, z: dz / d } : { x: Math.sin(facing), z: Math.cos(facing) };
        // Range as the sim measures it: a target edge to edge from the movement circle, a point
        // from the center (`combat/abilities.ts` resolveAim); a direction aim shows its reach.
        const radius =
          def.aim === "target"
            ? movementStats(player).radius + stats.range
            : def.aim === "point"
              ? stats.range
              : Math.max(0, ...areas.map(reach));
        ring.show(radius > 0 ? at : null, radius);
        if (def.aim !== "target") {
          // A point aim is pulled in to its range; a direction aim's point is the cursor itself.
          const k = def.aim === "point" && d > stats.range && d > 0 ? stats.range / d : 1;
          const point = { x: at.x + dx * k, z: at.z + dz * k };
          areas.forEach((area, i) => {
            const mesh = shapeFor(i, area);
            placeArea(mesh, area, at, dir, point);
            mesh.setEnabled(true);
          });
          shown = areas.length;
        }
      }
      for (let i = shown; i < shapes.length; i++) shapes[i]?.mesh.setEnabled(false);
    },
  };
}

/** How far an area reaches from the caster along the aim, m. */
function reach(area: Area): number {
  switch (area.kind) {
    case "circle":
      return area.at === "caster" ? area.radius : 0;
    case "cone":
      return area.range;
    case "line":
      return area.length;
  }
}
