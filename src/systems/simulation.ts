import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";
import { orbitSystem } from "@/systems/orbit";
import { pawnSystem } from "@/systems/pawn";
import { snapshotSystem } from "@/systems/snapshot";

export type System = (world: World<Entity>, dt: number, rng: Rng, input: InputFrame) => void;

/** A system with a stable name (function names don't survive minification), for the profiler. */
export type NamedSystem = { name: string; run: System };

/** Systems in run order. The snapshot always runs first (see `createSimulation`). */
export const defaultSystems: readonly NamedSystem[] = [
  { name: "orbit", run: orbitSystem },
  { name: "pawn", run: pawnSystem },
];

export type SimulationOptions = {
  /**
   * Wraps every system call, e.g. to time it. Must call `run` exactly once. Lives outside the
   * simulation so the simulation itself never reads the clock.
   */
  around?: (name: string, run: () => void) => void;
};

/**
 * The whole simulation, advanced one fixed tick at a time. Deterministic given the same world,
 * seed and inputs: systems only see the fixed `dt`, the seeded `rng` and the tick's `InputFrame`.
 */
export function createSimulation(
  world: World<Entity>,
  rng: Rng,
  systems: readonly NamedSystem[] = defaultSystems,
  { around }: SimulationOptions = {},
) {
  return {
    step(dt: number, input: InputFrame): void {
      snapshotSystem(world);
      for (const { name, run } of systems) {
        if (around) around(name, () => run(world, dt, rng, input));
        else run(world, dt, rng, input);
      }
    },
  };
}
