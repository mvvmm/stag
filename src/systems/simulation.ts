import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import { orbitSystem } from "@/systems/orbit";
import { snapshotSystem } from "@/systems/snapshot";

export type System = (world: World<Entity>, dt: number, rng: Rng) => void;

/** Systems in run order. The snapshot always runs first (see `createSimulation`). */
export const defaultSystems: readonly System[] = [orbitSystem];

/**
 * The whole simulation, advanced one fixed tick at a time. Deterministic given the same world,
 * seed and (later) inputs: systems only see the fixed `dt` and the seeded `rng`.
 */
export function createSimulation(
  world: World<Entity>,
  rng: Rng,
  systems: readonly System[] = defaultSystems,
) {
  return {
    step(dt: number): void {
      snapshotSystem(world);
      for (const system of systems) system(world, dt, rng);
    },
  };
}
