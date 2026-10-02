import type { Footprint } from "@/collision/body";
import type { Vec2 } from "@/core/math";

// Training dummies (the Training yard): targets with health and no AI, for trying abilities on.

/** Where a room puts a dummy. */
export type DummySpawn =
  /** Stands still. */
  | { kind: "static"; at: Vec2; facing?: number }
  /** Walks back and forth between `a` and `b`. */
  | { kind: "patrol"; a: Vec2; b: Vec2 };

/** A dummy's body for hits (its collision circle is the much smaller `dummy.radius` tunable). */
export const DUMMY_HURTBOX: Footprint = { radius: 0.6, length: 0 };
/** How tall a dummy stands, m (the view fits its model to it and hangs its health bar above). */
export const DUMMY_HEIGHT = 2.6;
