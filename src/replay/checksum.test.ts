import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { cloneTransform, createWorld } from "@/ecs/world";
import { checksumWorld, diffCheckpoints } from "@/replay/checksum";

const transform = (x = 0) => ({ position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

const build = () => {
  const world = createWorld();
  const a = world.add({ transform: transform(1), prevTransform: transform(1) });
  const b = world.add({
    transform: transform(2),
    player: { order: null, orders: 0, click: null, chase: false, attackMove: null },
  });
  return { world, a, b, rng: createRng(7) };
};

describe("checksumWorld", () => {
  it("matches for equal state and reports the entity count and components", () => {
    const one = build();
    const two = build();
    const first = checksumWorld(one.world, one.rng, 5);
    expect(first).toEqual(checksumWorld(two.world, two.rng, 5));
    expect(first.tick).toBe(5);
    expect(first.entities).toBe(2);
    expect(Object.keys(first.components)).toEqual(["player", "transform"]);
  });

  it("names the component that changed", () => {
    const { world, a, b, rng } = build();
    const before = checksumWorld(world, rng, 0);
    a.transform.position.x += 1e-12;
    expect(diffCheckpoints(before, checksumWorld(world, rng, 0))).toEqual(["transform"]);
    a.transform.position.x -= 1e-12;
    b.player.click = { x: 0, z: 0 } as never;
    expect(diffCheckpoints(before, checksumWorld(world, rng, 0))).toEqual(["player"]);
  });

  it("notices the RNG advancing and entities coming and going", () => {
    const { world, rng } = build();
    const before = checksumWorld(world, rng, 0);
    rng.next();
    expect(diffCheckpoints(before, checksumWorld(world, rng, 0))).toEqual(["rng"]);
    const after = checksumWorld(world, rng, 0);
    world.add({ orbit: { center: { x: 0, y: 0, z: 0 }, radius: 1, speed: 1, angle: 0 } });
    expect(diffCheckpoints(after, checksumWorld(world, rng, 0))).toEqual(["entities", "orbit"]);
  });

  it("ignores prevTransform and key order, but not which entity holds a value", () => {
    const { world, a, rng } = build();
    const before = checksumWorld(world, rng, 0);
    a.prevTransform = cloneTransform(transform(99));
    a.transform = { rotation: a.transform.rotation, position: a.transform.position };
    expect(diffCheckpoints(before, checksumWorld(world, rng, 0))).toEqual([]);

    const swapped = createWorld();
    swapped.add({ transform: transform(2) });
    swapped.add({ transform: transform(1) });
    const straight = createWorld();
    straight.add({ transform: transform(1) });
    straight.add({ transform: transform(2) });
    expect(checksumWorld(swapped, rng, 0)).not.toEqual(checksumWorld(straight, rng, 0));
  });

  it("tells 0 from -0 and 1 from true", () => {
    const hash = (value: unknown) => {
      const world = createWorld();
      world.add({ player: { click: value } as never });
      return checksumWorld(world, createRng(1), 0).components.player;
    };
    expect(hash(0)).not.toBe(hash(-0));
    expect(hash(1)).not.toBe(hash(true));
    expect(hash("1")).not.toBe(hash(1));
    expect(hash([1, 2])).not.toBe(hash({ 0: 1, 1: 2 }));
  });
});
