import type { World } from "miniplex";
import type { Entity } from "@/ecs/world";

/**
 * Gives `entity` the world's next `uid` and adds it. The counter lives on a singleton `ids` entity
 * (made on first use), so a snapshot restores it with the rest of the world.
 */
export function addWithUid(world: World<Entity>, entity: Entity): Entity {
  let ids = world.with("ids").first?.ids;
  if (!ids) {
    ids = { next: 1 };
    world.add({ ids });
  }
  entity.uid = ids.next++;
  return world.add(entity);
}

/** The entity with this `uid`, or undefined (never assigned, or removed). */
export function entityByUid(world: World<Entity>, uid: number | null): Entity | undefined {
  if (uid === null) return undefined;
  for (const entity of world.with("uid")) if (entity.uid === uid) return entity;
  return undefined;
}
