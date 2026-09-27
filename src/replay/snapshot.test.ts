import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { createWorld } from "@/ecs/world";
import { checksumWorld } from "@/replay/checksum";
import { decode, encode, restoreSnapshot, snapshotWorld } from "@/replay/snapshot";

describe("snapshot encoding", () => {
  it("round-trips plain data through JSON, including values JSON can't hold", () => {
    const value = {
      n: 1.5,
      zero: -0,
      nan: Number.NaN,
      inf: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      missing: undefined,
      nested: { s: "x", b: true, nil: null, list: [1, { deep: -0 }] },
    };
    const back = decode(JSON.parse(JSON.stringify(encode(value)))) as typeof value;
    expect(back).toEqual(value);
    expect(Object.is(back.zero, -0)).toBe(true);
    expect("missing" in back).toBe(true);
    expect(Object.is((back.nested.list[1] as { deep: number }).deep, -0)).toBe(true);
  });

  it("refuses anything that isn't plain data, naming where it is", () => {
    expect(() => encode({ pawn: { when: new Date() } })).toThrow("entity.pawn.when");
    expect(() => encode({ f: () => 1 })).toThrow("isn't plain data");
    expect(() => encode({ s: new Set([1]) })).toThrow("entity.s");
  });
});

describe("snapshotWorld / restoreSnapshot", () => {
  it("restores an identical world and RNG", () => {
    const world = createWorld();
    const rng = createRng(4);
    world.add({ pawn: { target: { x: -0, z: 2 } } });
    world.add({
      transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0.5, z: 0 } },
    });
    rng.next();
    const snapshot = JSON.parse(JSON.stringify(snapshotWorld(world, rng, 99)));

    const restored = createWorld();
    const restoredRng = createRng(1);
    restoreSnapshot(snapshot, restored, restoredRng);
    expect(checksumWorld(restored, restoredRng, 0)).toEqual(checksumWorld(world, rng, 0));
    expect(restoredRng.next()).toBe(rng.next());
  });
});
