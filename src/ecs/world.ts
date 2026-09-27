import { World } from "miniplex";

export type Vec3 = { x: number; y: number; z: number };

export type Transform = {
  position: Vec3;
  /** Euler rotation in radians. */
  rotation: Vec3;
};

/** Rotates the entity around the Y axis at `speed` radians per second. */
export type Spin = { speed: number };

export type Entity = {
  transform?: Transform;
  spin?: Spin;
};

export function createWorld(): World<Entity> {
  return new World<Entity>();
}
