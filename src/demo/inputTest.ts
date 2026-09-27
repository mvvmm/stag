import type { World } from "miniplex";
import { dmath } from "@/core/dmath";
import type { Rng } from "@/core/rng";
import { cloneTransform, type Entity, type Pawn } from "@/ecs/world";
import type { SceneSim } from "@/scenes/sim";
import { orbitSystem } from "@/systems/orbit";
import { pawnSystem } from "@/systems/pawn";

// Throwaway input test scene for step 0.3 (grown from the 0.2 loop test); replaced in 1.1/1.2.
// The simulation half; the view (materials, markers, input overlay) is in `inputTest.view.ts`.

export const inputTestSim: SceneSim = {
  id: "input-test",
  label: "Input test",
  systems: [
    { name: "orbit", run: orbitSystem },
    { name: "pawn", run: pawnSystem },
  ],
  spawn,
};

function spawn(world: World<Entity>, rng: Rng): void {
  // One fast box makes 60 Hz judder obvious on a high-refresh display when interpolation is off.
  const orbits = [
    { radius: 7, speed: 3 },
    ...Array.from({ length: 4 }, () => ({
      radius: rng.range(1.5, 6),
      speed: rng.range(0.6, 2.5) * rng.pick([-1, 1]),
    })),
  ];

  const center = { x: 0, y: 0.3, z: 0 };
  for (const { radius, speed } of orbits) {
    const angle = rng.range(0, Math.PI * 2);
    const transform = {
      position: {
        x: center.x + dmath.cos(angle) * radius,
        y: center.y,
        z: center.z + dmath.sin(angle) * radius,
      },
      rotation: { x: 0, y: -angle, z: 0 },
    };
    world.add({
      transform,
      prevTransform: cloneTransform(transform),
      orbit: { center, radius, speed, angle },
    });
  }

  const pawnState: Pawn = { target: null };
  const pawnTransform = { position: { x: 0, y: 0.3, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  world.add({
    transform: pawnTransform,
    prevTransform: cloneTransform(pawnTransform),
    pawn: pawnState,
  });
}
