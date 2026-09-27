import { World } from "miniplex";

export type Vec3 = { x: number; y: number; z: number };

export type Transform = {
  position: Vec3;
  /** Euler rotation in radians. */
  rotation: Vec3;
};

/** Moves the entity in a circle around `center` on the ground plane. Throwaway demo component. */
export type Orbit = {
  center: Vec3;
  radius: number;
  /** Angular speed in radians per second. */
  speed: number;
  /** Current angle in radians. */
  angle: number;
};

export type Entity = {
  transform?: Transform;
  /** Transform at the start of the current tick; the renderer interpolates from it. */
  prevTransform?: Transform;
  orbit?: Orbit;
};

export function createWorld(): World<Entity> {
  return new World<Entity>();
}

export function cloneTransform({ position: p, rotation: r }: Transform): Transform {
  return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: r.x, y: r.y, z: r.z } };
}

export function copyTransform(from: Transform, to: Transform): void {
  to.position.x = from.position.x;
  to.position.y = from.position.y;
  to.position.z = from.position.z;
  to.rotation.x = from.rotation.x;
  to.rotation.y = from.rotation.y;
  to.rotation.z = from.rotation.z;
}

/**
 * Makes the renderer show the current transform without interpolating from the previous one.
 * Call after teleports and spawns so they don't smear across a frame.
 */
export function snapTransform(entity: Entity): void {
  if (entity.transform && entity.prevTransform) {
    copyTransform(entity.transform, entity.prevTransform);
  }
}
