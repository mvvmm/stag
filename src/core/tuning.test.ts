import { describe, expect, it } from "vitest";
import { createTuningRegistry, formatChanges } from "@/core/tuning";

const setup = () => {
  const tuning = createTuningRegistry();
  const pawn = tuning.define("pawn", {
    speed: { value: 6, min: 0, max: 20, step: 0.1 },
    ghost: { value: false },
    mode: { value: "walk", options: ["walk", "run"] },
  });
  return { tuning, pawn };
};

describe("tuning registry", () => {
  it("returns live values with inferred types", () => {
    const { tuning, pawn } = setup();
    const speed: number = pawn.speed;
    expect(speed).toBe(6);

    tuning.set("pawn.speed", 7.5);
    expect(pawn.speed).toBe(7.5);
    expect(tuning.get("pawn.speed")).toBe(7.5);
  });

  it("validates sets: clamps numbers, rejects wrong types and unknown ids", () => {
    const { tuning, pawn } = setup();
    expect(tuning.set("pawn.speed", 99)).toBe(true);
    expect(pawn.speed).toBe(20);
    expect(tuning.set("pawn.speed", 0.1 + 0.2)).toBe(true);
    expect(pawn.speed).toBe(0.3);

    expect(tuning.set("pawn.speed", "fast")).toBe(false);
    expect(tuning.set("pawn.ghost", 1)).toBe(false);
    expect(tuning.set("pawn.mode", "fly")).toBe(false);
    expect(tuning.set("pawn.nope", 1)).toBe(false);
    expect(tuning.set("nope.speed", 1)).toBe(false);
    expect(pawn.mode).toBe("walk");
  });

  it("applies stored overrides and drops stale ones", () => {
    const { tuning, pawn } = setup();
    const dropped = tuning.apply({
      "pawn.speed": 8,
      "pawn.ghost": true,
      "pawn.mode": "fly", // no longer an option
      "pawn.jump": 3, // removed tunable
      "camera.fov": 50, // removed group
    });
    expect(pawn.speed).toBe(8);
    expect(pawn.ghost).toBe(true);
    expect(dropped).toEqual(["pawn.mode", "pawn.jump", "camera.fov"]);

    // Out of range is stale, not clamped.
    expect(tuning.apply({ "pawn.speed": 50 })).toEqual(["pawn.speed"]);
    expect(pawn.speed).toBe(8);
  });

  it("lists changes and overrides", () => {
    const { tuning } = setup();
    tuning.set("pawn.speed", 7.5);
    tuning.set("pawn.ghost", true);
    expect(tuning.changes()).toEqual([
      { id: "pawn.speed", from: 6, to: 7.5 },
      { id: "pawn.ghost", from: false, to: true },
    ]);
    expect(tuning.overrides()).toEqual({ "pawn.speed": 7.5, "pawn.ghost": true });

    tuning.set("pawn.speed", 6);
    expect(tuning.overrides()).toEqual({ "pawn.ghost": true });
  });

  it("resets one value, one group or everything", () => {
    const { tuning, pawn } = setup();
    const camera = tuning.define("camera", { fov: { value: 45 } });
    const tweak = () => {
      tuning.set("pawn.speed", 7);
      tuning.set("pawn.ghost", true);
      tuning.set("camera.fov", 60);
    };

    tweak();
    tuning.reset("pawn.speed");
    expect([pawn.speed, pawn.ghost, camera.fov]).toEqual([6, true, 60]);

    tweak();
    tuning.reset("pawn");
    expect([pawn.speed, pawn.ghost, camera.fov]).toEqual([6, false, 60]);

    tweak();
    tuning.reset();
    expect(tuning.changes()).toEqual([]);
  });

  it("notifies listeners of changes, but not of no-op sets", () => {
    const { tuning } = setup();
    const seen: (string | null)[] = [];
    const off = tuning.onChange((id) => seen.push(id));

    tuning.set("pawn.speed", 7);
    tuning.set("pawn.speed", 7);
    tuning.define("camera", { fov: { value: 45 } });
    off();
    tuning.set("pawn.speed", 8);

    expect(seen).toEqual(["pawn.speed", null]);
  });

  it("redefining a group keeps tweaks that are still valid", () => {
    const { tuning } = setup();
    tuning.set("pawn.speed", 9);
    tuning.set("pawn.ghost", true);

    const pawn = tuning.define("pawn", {
      speed: { value: 5, min: 0, max: 20 },
      ghost: { value: "no", options: ["no", "yes"] }, // type changed: tweak dropped
    });
    expect(pawn.speed).toBe(9);
    expect(pawn.ghost).toBe("no");
    expect(tuning.list().map((t) => t.id)).toEqual(["pawn.speed", "pawn.ghost"]);
  });
});

describe("formatChanges", () => {
  it("formats one line per change", () => {
    expect(
      formatChanges([
        { id: "pawn.speed", from: 6, to: 7.5 },
        { id: "pawn.mode", from: "walk", to: "run" },
      ]),
    ).toBe('pawn.speed: 6 → 7.5\npawn.mode: "walk" → "run"');
    expect(formatChanges([])).toBe("");
  });
});
