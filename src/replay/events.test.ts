import { describe, expect, it } from "vitest";
import { createWorld } from "@/ecs/world";
import { applyEdit } from "@/replay/events";

const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

describe("applyEdit", () => {
  it("sets the field by entity index and snaps transform edits", () => {
    const world = createWorld();
    world.add({ player: { order: null, orders: 0, click: null, chase: false, attackMove: null } });
    const moved = world.add({ transform: transform(), prevTransform: transform() });
    expect(applyEdit(world, { entity: 1, path: ["transform", "position", "x"], value: 4 })).toBe(
      true,
    );
    expect(moved.transform.position.x).toBe(4);
    expect(moved.prevTransform.position.x).toBe(4);
  });

  it("returns false when the entity or the field's parent is gone", () => {
    const world = createWorld();
    world.add({ player: { order: null, orders: 0, click: null, chase: false, attackMove: null } });
    expect(applyEdit(world, { entity: 3, path: ["player", "order"], value: 1 })).toBe(false);
    expect(applyEdit(world, { entity: 0, path: ["orbit", "angle"], value: 1 })).toBe(false);
  });
});
