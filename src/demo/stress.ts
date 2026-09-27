import { dmath } from "@/core/dmath";
import { defineTunables } from "@/core/tuning";
import { cloneTransform } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { orbitSystem } from "@/systems/orbit";

// Throwaway benchmark scene: lots of orbiting boxes, one mesh each (deliberately no instancing,
// so the 9.6 performance pass has a baseline to measure against). The view restarts the scene
// when the count changes (`stress.view.ts`).

export const STRESS = defineTunables("stress", {
  /** Orbiting boxes; changing it restarts the stress scene. */
  count: { value: 500, min: 10, max: 5000, step: 10 },
});

export const stressSim: SceneSim = {
  id: "stress",
  label: "Stress (orbiting boxes)",
  systems: [{ name: "orbit", run: orbitSystem }],
  spawn(world, rng) {
    const count = STRESS.count;
    for (let i = 0; i < count; i++) {
      const radius = rng.range(1, 9.5);
      const angle = rng.range(0, Math.PI * 2);
      const center = { x: 0, y: rng.range(0.3, 3), z: 0 };
      const transform = {
        position: {
          x: dmath.cos(angle) * radius,
          y: center.y,
          z: dmath.sin(angle) * radius,
        },
        rotation: { x: 0, y: -angle, z: 0 },
      };
      world.add({
        transform,
        prevTransform: cloneTransform(transform),
        orbit: { center, radius, speed: rng.range(0.3, 2.5) * rng.pick([-1, 1]), angle },
      });
    }
  },
};
