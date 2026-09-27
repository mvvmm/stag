import { describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { createWorld, type Pawn } from "@/ecs/world";
import { emptyInputFrame, type InputFrame } from "@/input/actions";
import { pawnSystem } from "@/systems/pawn";

const rng = createRng(1);

const spawn = (speed = 2) => {
  const world = createWorld();
  const pawn: Pawn = { speed, target: null };
  const entity = world.add({
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    pawn,
  });
  return { world, entity };
};

const frame = (overrides: Partial<InputFrame>): InputFrame => ({
  ...emptyInputFrame(),
  ...overrides,
});

describe("pawnSystem", () => {
  it("moves along the input direction at its speed", () => {
    const { world, entity } = spawn(2);
    pawnSystem(world, 0.5, rng, frame({ move: { x: 0, z: -1 } }));
    expect(entity.transform.position).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("walks to a click-to-move target and stops there", () => {
    const { world, entity } = spawn(2);
    pawnSystem(world, 0.5, rng, frame({ moveCommand: { x: 3, z: 0 } }));
    expect(entity.transform.position.x).toBeCloseTo(1);
    expect(entity.pawn.target).toEqual({ x: 3, z: 0 });

    // The target persists after the button is released.
    pawnSystem(world, 0.5, rng, frame({}));
    pawnSystem(world, 0.5, rng, frame({}));
    expect(entity.transform.position.x).toBe(3);
    expect(entity.pawn.target).toBeNull();
  });

  it("clears the target on stop", () => {
    const { world, entity } = spawn(2);
    pawnSystem(world, 0.5, rng, frame({ moveCommand: { x: 3, z: 0 } }));
    pawnSystem(world, 0.5, rng, frame({ pressed: new Set(["stop"]) }));
    expect(entity.pawn.target).toBeNull();
    expect(entity.transform.position.x).toBeCloseTo(1);
  });

  it("lets direct input override the target", () => {
    const { world, entity } = spawn(2);
    entity.pawn.target = { x: 10, z: 0 };
    pawnSystem(world, 0.5, rng, frame({ move: { x: 0, z: 1 } }));
    expect(entity.pawn.target).toBeNull();
    expect(entity.transform.position).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("faces the aim point", () => {
    const { world, entity } = spawn();
    pawnSystem(world, 0.1, rng, frame({ aim: { x: 1, z: 0 } }));
    expect(entity.transform.rotation.y).toBeCloseTo(Math.PI / 2);
    pawnSystem(world, 0.1, rng, frame({ aim: { x: 0, z: -1 } }));
    expect(Math.abs(entity.transform.rotation.y)).toBeCloseTo(Math.PI);
  });
});
