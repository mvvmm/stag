import type { Footprint } from "@/collision/body";
import type { Vec2 } from "@/core/math";

// Training dummies (the Training yard): targets with health and no AI, for trying abilities on.

/** Where a room puts a dummy. */
export type DummySpawn =
  /** Stands still, and blocks movement and paths like a pillar. */
  | { kind: "static"; at: Vec2; facing?: number }
  /** Walks back and forth between `a` and `b` (it walks through the player, until 3.4). */
  | { kind: "patrol"; a: Vec2; b: Vec2 };

/** A dummy's footprint for movement and blocking (its base), m. */
export const DUMMY_RADIUS = 0.35;
/** A dummy's body for hits: a bit wider than its base (the arms). */
export const DUMMY_HURTBOX: Footprint = { radius: 0.45, length: 0 };
/** How tall a dummy stands, m (its obstacle height, and where the view puts its health bar). */
export const DUMMY_HEIGHT = 1.8;
