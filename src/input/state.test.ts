import { describe, expect, it } from "vitest";
import { createInputState } from "@/input/state";

const tap = (input: ReturnType<typeof createInputState>, control: string) => {
  input.controlDown(control);
  input.controlUp(control);
};

describe("createInputState: actions", () => {
  it("reports pressed, held and released for keys and mouse buttons", () => {
    const input = createInputState("mmo");

    input.controlDown("Digit1");
    input.controlDown("Mouse2");
    let frame = input.sampleTick(0);
    expect([...frame.pressed]).toEqual(["ability1", "primary"]);
    expect([...frame.held]).toEqual(["ability1", "primary"]);

    frame = input.sampleTick(0);
    expect(frame.pressed.size).toBe(0);
    expect([...frame.held]).toEqual(["ability1", "primary"]);

    input.controlUp("Digit1");
    frame = input.sampleTick(0);
    expect([...frame.released]).toEqual(["ability1"]);
    expect([...frame.held]).toEqual(["primary"]);
  });

  it("reports a tap within one frame as pressed and released, not held", () => {
    const input = createInputState("mmo");
    tap(input, "Space");

    const frame = input.sampleTick(0);
    expect(frame.pressed.has("dodge")).toBe(true);
    expect(frame.released.has("dodge")).toBe(true);
    expect(frame.held.has("dodge")).toBe(false);
  });

  it("keeps a press latched across frames that run no ticks", () => {
    const input = createInputState("mmo");
    tap(input, "Space");
    input.sampleFrame(); // a paused frame: no tick samples

    expect(input.sampleTick(0).pressed.has("dodge")).toBe(true);
  });

  it("reports a press to only the first of several ticks", () => {
    const input = createInputState("mmo");
    input.controlDown("Space");

    expect(input.sampleTick(0).pressed.has("dodge")).toBe(true);
    expect(input.sampleTick(0).pressed.has("dodge")).toBe(false);
    expect(input.sampleTick(0).held.has("dodge")).toBe(true);
  });

  it("latches ticks and frames independently", () => {
    const input = createInputState("mmo");
    tap(input, "Escape");

    expect(input.sampleFrame().pressed.has("pause")).toBe(true);
    expect(input.sampleTick(0).pressed.has("pause")).toBe(true);
    expect(input.sampleFrame().pressed.has("pause")).toBe(false);
  });

  it("ignores repeated downs and unbound controls", () => {
    const input = createInputState("mmo");
    input.controlDown("Space");
    input.sampleTick(0);
    input.controlDown("Space");
    input.controlDown("KeyZ");

    const frame = input.sampleTick(0);
    expect(frame.pressed.size).toBe(0);
    expect([...frame.held]).toEqual(["dodge"]);
    expect(input.isBound("KeyZ")).toBe(false);
    expect(input.isBound("Space")).toBe(true);
    expect(input.isBound("KeyW")).toBe(true);
  });

  it("releases everything with released edges", () => {
    const input = createInputState("mmo");
    input.controlDown("Digit2");
    input.controlDown("KeyW");
    input.sampleTick(0);

    input.releaseAll();
    const frame = input.sampleTick(0);
    expect([...frame.released]).toEqual(["ability2"]);
    expect(frame.held.size).toBe(0);
    expect(frame.move).toEqual({ x: 0, z: 0 });
  });

  it("clears held state when switching presets", () => {
    const input = createInputState("mmo");
    input.controlDown("KeyW");
    input.controlDown("Digit1");
    input.setPreset("moba");

    const frame = input.sampleTick(0);
    expect(frame.held.size).toBe(0);
    expect(frame.released.has("ability1")).toBe(true);
    expect(input.preset.id).toBe("moba");

    // W is now ability2; the physical key still being down from before doesn't count.
    input.controlUp("KeyW");
    expect(input.sampleTick(0).released.size).toBe(0);
    input.controlDown("KeyW");
    expect(input.sampleTick(0).pressed.has("ability2")).toBe(true);
  });
});

describe("createInputState: WASD movement", () => {
  it("moves in screen directions and normalizes diagonals", () => {
    const input = createInputState("mmo");
    input.controlDown("KeyW");
    expect(input.sampleTick(0).move).toEqual({ x: 0, z: 1 });

    input.controlDown("KeyD");
    const move = input.sampleTick(0).move;
    expect(move.x).toBeCloseTo(Math.SQRT1_2);
    expect(move.z).toBeCloseTo(Math.SQRT1_2);
  });

  it("supports the arrow keys", () => {
    const input = createInputState("mmo");
    input.controlDown("ArrowLeft");
    expect(input.sampleTick(0).move).toEqual({ x: -1, z: 0 });
  });

  it("rotates by the camera yaw", () => {
    const input = createInputState("mmo");
    input.controlDown("KeyW");
    const move = input.sampleTick(Math.PI / 2).move;
    expect(move.x).toBeCloseTo(1);
    expect(move.z).toBeCloseTo(0);
  });

  it("lets the last pressed direction win on each axis", () => {
    const input = createInputState("mmo");
    input.controlDown("KeyA");
    expect(input.sampleTick(0).move.x).toBe(-1);

    input.controlDown("KeyD");
    expect(input.sampleTick(0).move.x).toBe(1);

    input.controlUp("KeyD");
    expect(input.sampleTick(0).move.x).toBe(-1);

    input.controlDown("KeyD");
    input.controlUp("KeyA");
    input.controlDown("KeyA");
    expect(input.sampleTick(0).move.x).toBe(-1);
  });

  it("gives no move vector or move command in the moba scheme", () => {
    const input = createInputState("moba");
    input.controlDown("KeyW");
    const frame = input.sampleTick(0);
    expect(frame.move).toEqual({ x: 0, z: 0 });
    expect(frame.moveCommand).toBeNull();
  });
});

describe("createInputState: click to move", () => {
  it("sends the aim point while the move button is held", () => {
    const input = createInputState("moba");
    input.setAim({ x: 3, z: 4 });
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toEqual({ x: 3, z: 4 });

    input.setAim({ x: 5, z: 6 });
    expect(input.sampleTick(0).moveCommand).toEqual({ x: 5, z: 6 });

    input.controlUp("Mouse2");
    expect(input.sampleTick(0).moveCommand).toBeNull();
  });

  it("still sends a click shorter than a tick", () => {
    const input = createInputState("moba");
    input.setAim({ x: 1, z: 2 });
    tap(input, "Mouse2");

    expect(input.sampleTick(0).moveCommand).toEqual({ x: 1, z: 2 });
    expect(input.sampleTick(0).moveCommand).toBeNull();
  });

  it("has no move command in the mmo scheme", () => {
    const input = createInputState("mmo");
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toBeNull();
  });

  it("copies the aim point into each frame", () => {
    const input = createInputState("mmo");
    input.setAim({ x: 7, z: -2 });
    const frame = input.sampleTick(0);
    input.setAim({ x: 0, z: 0 });
    expect(frame.aim).toEqual({ x: 7, z: -2 });
  });
});

describe("createInputState: mouse buttons off (debug free camera)", () => {
  it("releases held buttons with edges and ignores new presses, but keeps keys", () => {
    const input = createInputState("mmo");
    input.controlDown("Mouse2");
    input.controlDown("Digit1");
    input.sampleTick(0);

    input.setMouseButtons(false);
    input.controlDown("Mouse0");
    input.controlDown("Space");
    const frame = input.sampleTick(0);
    expect([...frame.released]).toEqual(["primary"]);
    expect([...frame.pressed]).toEqual(["dodge"]);
    expect([...frame.held]).toEqual(["ability1", "dodge"]);
  });

  it("sends no move command in the moba scheme while off", () => {
    const input = createInputState("moba");
    input.setAim({ x: 1, z: 1 });
    input.setMouseButtons(false);
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toBeNull();

    input.setMouseButtons(true);
    input.controlUp("Mouse2");
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toEqual({ x: 1, z: 1 });
  });
});
