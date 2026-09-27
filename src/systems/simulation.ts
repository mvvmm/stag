import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { orbitSystem } from "@/systems/orbit";
import { pawnSystem } from "@/systems/pawn";
import { snapshotSystem } from "@/systems/snapshot";

export type System = (world: World<Entity>, dt: number, rng: Rng, input: InputFrame) => void;

/** Systems in run order. The snapshot always runs first (see `createSimulation`). */
export const defaultSystems: readonly System[] = [orbitSystem, pawnSystem];

/**
 * The whole simulation, advanced one fixed tick at a time. Deterministic given the same world,
 * seed and inputs: systems only see the fixed `dt`, the seeded `rng` and the tick's `InputFrame`.
 */
export function createSimulation(
  world: World<Entity>,
  rng: Rng,
  systems: readonly System[] = defaultSystems,
) {
  return {
    step(dt: number, input: InputFrame): void {
      snapshotSystem(world);
      for (const system of systems) system(world, dt, rng, input);
    },
  };
}
