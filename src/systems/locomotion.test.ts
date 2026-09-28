import { afterEach, describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { createWorld, type Mover, type Transform } from "@/ecs/world";
import { emptyInputFrame } from "@/input/actions";
import { locomotionSystem, moveToward } from "@/systems/locomotion";
import { PLAYER } from "@/systems/movementStats";

const DT = 1 / 60;

function setup(velocity = { x: 0, z: 0 }, facing = 0) {
  const world = createWorld();
  const transform: Transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: facing, z: 0 },
  };
  const mover: Mover = { velocity: { ...velocity }, desired: { x: 0, z: 0 } };
  world.add({ transform, mover });
  const rng = createRng(1);
  const step = (dt = DT) => locomotionSystem(world, dt, rng, emptyInputFrame());
  return { transform, mover, step };
}

afterEach(() => tuning.reset());

describe("moveToward", () => {
  it("steps by at most `step` and lands exactly", () => {
    const v = { x: 0, z: 0 };
    moveToward(v, { x: 3, z: 4 }, 1);
    expect(v.x).toBeCloseTo(0.6, 12);
    expect(v.z).toBeCloseTo(0.8, 12);
    moveToward(v, { x: 3, z: 4 }, 10);
    expect(v).toEqual({ x: 3, z: 4 });
  });
});

describe("locomotion", () => {
  it("reaches top speed in speed / accel", () => {
    const { mover, step } = setup();
    mover.desired = { x: PLAYER.speed, z: 0 };
    const ticks = Math.ceil(PLAYER.speed / PLAYER.accel / DT);
    for (let i = 0; i < ticks - 1; i++) step();
    expect(mover.velocity.x).toBeLessThan(PLAYER.speed);
    step();
    expect(mover.velocity).toEqual({ x: PLAYER.speed, z: 0 });
  });

  it("stops dead at the decel rate, without drifting back", () => {
    const { transform, mover, step } = setup({ x: 7, z: 0 });
    const ticks = Math.ceil(7 / PLAYER.decel / DT);
    for (let i = 0; i < ticks; i++) {
      step();
      expect(mover.velocity.x).toBeGreaterThanOrEqual(0);
    }
    expect(mover.velocity).toEqual({ x: 0, z: 0 });
    const stoppedAt = transform.position.x;
    for (let i = 0; i < 30; i++) step();
    expect(transform.position.x).toBe(stoppedAt);
  });

  it("brakes through zero at turnAccel when reversing, then speeds up at accel", () => {
    tuning.set("player.turnAccel", 300);
    const { mover, step } = setup({ x: 7, z: 0 });
    mover.desired = { x: -7, z: 0 };
    step();
    expect(mover.velocity.x).toBeCloseTo(7 - 300 * DT, 9);
    step();
    expect(mover.velocity.x).toBeCloseTo(7 - 600 * DT, 9); // just past zero
    step(); // now along the desired direction: accel
    expect(mover.velocity.x).toBeCloseTo(7 - 600 * DT - PLAYER.accel * DT, 9);
  });

  it("speeds up and steers at accel", () => {
    const { mover, step } = setup({ x: 7, z: 0 });
    mover.desired = { x: 0, z: 7 }; // 90°: not against the velocity
    step();
    const change = Math.hypot(mover.velocity.x - 7, mover.velocity.z);
    expect(change).toBeCloseTo(PLAYER.accel * DT, 9);
  });

  it("uses the dt it's given", () => {
    const { mover, step } = setup();
    mover.desired = { x: 7, z: 0 };
    step(1 / 30);
    expect(mover.velocity.x).toBeCloseTo(PLAYER.accel / 30, 9);
  });

  it("turns the facing toward the movement at turnRate, the short way round", () => {
    const { transform, mover, step } = setup({ x: 7, z: 0 }); // moving +X: facing π/2
    mover.desired = { x: 7, z: 0 };
    step();
    expect(transform.rotation.y).toBeCloseTo(((PLAYER.turnRate * Math.PI) / 180) * DT, 9);
    for (let i = 0; i < 30; i++) step();
    expect(transform.rotation.y).toBeCloseTo(Math.PI / 2, 9);

    // Facing just short of +π, moving just past -π: turns up through π, not all the way round.
    const wrap = setup({ x: -0.5, z: -7 }, Math.PI - 0.2);
    wrap.mover.desired = { x: -0.5, z: -7 };
    wrap.step();
    const target = Math.atan2(-0.5, -7); // ≈ -π + 0.07
    const turned = wrap.transform.rotation.y;
    expect(turned > Math.PI - 0.2 || turned < target + 1e-9).toBe(true);
    for (let i = 0; i < 10; i++) wrap.step();
    expect(wrap.transform.rotation.y).toBeCloseTo(target, 9);
  });

  it("keeps its facing when stopped", () => {
    const { transform, step } = setup({ x: 0, z: 0 }, 1.2);
    for (let i = 0; i < 10; i++) step();
    expect(transform.rotation.y).toBe(1.2);
  });
});
