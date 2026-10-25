import { describe, expect, it } from "vitest";
import { quantize } from "@/input/quantize";
import { createInputState } from "@/input/state";

const tap = (input: ReturnType<typeof createInputState>, control: string) => {
  input.controlDown(control);
  input.controlUp(control);
};

describe("createInputState: actions", () => {
  it("reports pressed, held and released for keys and mouse buttons", () => {
    const input = createInputState("mmo");

    input.controlDown("Digit1");
    input.controlDown("Mouse0");
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
    tap(input, "KeyF");

    const frame = input.sampleTick(0);
    expect(frame.pressed.has("interact")).toBe(true);
    expect(frame.released.has("interact")).toBe(true);
    expect(frame.held.has("interact")).toBe(false);
  });

  it("keeps a press latched across frames that run no ticks", () => {
    const input = createInputState("mmo");
    tap(input, "KeyF");
    input.sampleFrame(); // a paused frame: no tick samples

    expect(input.sampleTick(0).pressed.has("interact")).toBe(true);
  });

  it("reports a press to only the first of several ticks", () => {
    const input = createInputState("mmo");
    input.controlDown("KeyF");

    expect(input.sampleTick(0).pressed.has("interact")).toBe(true);
    expect(input.sampleTick(0).pressed.has("interact")).toBe(false);
    expect(input.sampleTick(0).held.has("interact")).toBe(true);
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
    input.controlDown("KeyF");
    input.sampleTick(0);
    input.controlDown("KeyF");
    input.controlDown("KeyZ");

    const frame = input.sampleTick(0);
    expect(frame.pressed.size).toBe(0);
    expect([...frame.held]).toEqual(["interact"]);
    expect(input.isBound("KeyZ")).toBe(false);
    expect(input.isBound("KeyF")).toBe(true);
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

  it("quantizes aim, move command and move direction for replays", () => {
    const input = createInputState("moba");
    input.setAim({ x: 1.00049, z: -2.3 });
    input.controlDown("Mouse2");
    const frame = input.sampleTick(0);
    expect(frame.aim).toEqual({ x: quantize(1.00049), z: quantize(-2.3) });
    expect(frame.moveCommand).toEqual(frame.aim);

    const mmo = createInputState("mmo");
    mmo.controlDown("KeyW");
    mmo.controlDown("KeyD");
    const { move } = mmo.sampleTick(0.3);
    expect(move.x).toBe(quantize(move.x));
    expect(move.z).toBe(quantize(move.z));
    expect(Math.hypot(move.x, move.z)).toBeLessThanOrEqual(1);
  });
});

describe("createInputState: Shift chords", () => {
  it("Shift + right-click is an attack move (armed and confirmed), not a move or attack order", () => {
    const input = createInputState("moba");
    expect(input.isBound("ShiftLeft")).toBe(true);
    input.setAim({ x: 2, z: 3 });
    input.controlDown("ShiftLeft");
    input.controlDown("Mouse2");
    let frame = input.sampleTick(0);
    expect([...frame.pressed].sort()).toEqual(["attackMove", "confirm"]);
    expect(frame.moveCommand).toBeNull();

    // Letting go of Shift first still releases the chord with the button.
    input.controlUp("ShiftLeft");
    frame = input.sampleTick(0);
    expect(frame.moveCommand).toBeNull();
    expect([...frame.held].sort()).toEqual(["attackMove", "confirm"]);
    input.controlUp("Mouse2");
    frame = input.sampleTick(0);
    expect([...frame.released].sort()).toEqual(["attackMove", "confirm"]);
    expect(frame.held.size).toBe(0);

    // Without Shift it's a right-click again.
    input.controlDown("Mouse2");
    frame = input.sampleTick(0);
    expect([...frame.pressed]).toEqual(["primary"]);
    expect(frame.moveCommand).toEqual({ x: 2, z: 3 });
  });

  it("leaves Shift unbound where no chord uses it", () => {
    expect(createInputState("mmo").isBound("ShiftLeft")).toBe(false);
  });
});

describe("createInputState: cast-mode chords", () => {
  it("a slot key alone quick casts, with Shift normal casts, with Alt self casts", () => {
    const input = createInputState("moba");
    tap(input, "KeyQ");
    expect([...input.sampleTick(0).pressed]).toEqual(["ability1"]);

    input.controlDown("ShiftLeft");
    tap(input, "KeyW");
    input.controlUp("ShiftLeft");
    expect([...input.sampleTick(0).pressed].sort()).toEqual(["ability2", "normalCast"]);

    input.controlDown("AltRight");
    tap(input, "KeyD");
    input.controlUp("AltRight");
    expect([...input.sampleTick(0).pressed].sort()).toEqual(["extra1", "selfCast"]);
  });

  it("releases an Alt chord with its key, even when Alt goes up first", () => {
    const input = createInputState("moba");
    input.controlDown("AltLeft");
    input.controlDown("KeyF");
    input.controlUp("AltLeft");
    let frame = input.sampleTick(0);
    expect([...frame.held].sort()).toEqual(["extra2", "selfCast"]);

    input.controlUp("KeyF");
    frame = input.sampleTick(0);
    expect([...frame.released].sort()).toEqual(["extra2", "selfCast"]);
    expect(frame.held.size).toBe(0);
  });

  it("with Shift and Alt both held, a bound Alt chord wins, else the Shift one", () => {
    const input = createInputState("moba");
    input.controlDown("ShiftLeft");
    input.controlDown("AltLeft");
    tap(input, "KeyE");
    expect([...input.sampleTick(0).pressed].sort()).toEqual(["ability3", "selfCast"]);

    // There's no `Alt+Mouse2`, so Shift + right-click is still an attack move.
    tap(input, "Mouse2");
    expect([...input.sampleTick(0).pressed].sort()).toEqual(["attackMove", "confirm"]);
  });

  it("falls back to the plain control when Alt has no chord for it", () => {
    const input = createInputState("moba");
    input.controlDown("AltLeft");
    tap(input, "KeyA");
    expect([...input.sampleTick(0).pressed]).toEqual(["stop"]);
  });

  it("binds Alt where chords use it, and the Alt chords themselves", () => {
    const moba = createInputState("moba");
    expect(moba.isBound("AltLeft")).toBe(true);
    expect(moba.isBound("AltRight")).toBe(true);
    expect(moba.isBound("Alt+KeyQ")).toBe(true);
    expect(moba.isBound("Alt+KeyA")).toBe(false);
    expect(createInputState("mmo").isBound("AltLeft")).toBe(false);
  });
});

describe("createInputState: borrowed mouse (debug free camera, picker)", () => {
  it("releases held buttons with edges and ignores new presses, but keeps keys", () => {
    const input = createInputState("mmo");
    input.controlDown("Mouse0");
    input.controlDown("Digit1");
    input.sampleTick(0);

    input.borrowMouse("freeCamera", true);
    input.controlDown("Mouse2");
    input.controlDown("KeyF");
    const frame = input.sampleTick(0);
    expect([...frame.released]).toEqual(["primary"]);
    expect([...frame.pressed]).toEqual(["interact"]);
    expect([...frame.held]).toEqual(["ability1", "interact"]);
  });

  it("sends no move command in the moba scheme while off", () => {
    const input = createInputState("moba");
    input.setAim({ x: 1, z: 1 });
    input.borrowMouse("freeCamera", true);
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toBeNull();

    input.borrowMouse("freeCamera", false);
    input.controlUp("Mouse2");
    input.controlDown("Mouse2");
    expect(input.sampleTick(0).moveCommand).toEqual({ x: 1, z: 1 });
  });

  it("gives the mouse back only when every borrower has returned it", () => {
    const input = createInputState("mmo");
    input.borrowMouse("freeCamera", true);
    input.borrowMouse("picker", true);
    input.borrowMouse("freeCamera", false);
    expect(input.mouseButtons).toBe(false);
    input.controlDown("Mouse0");
    expect(input.sampleTick(0).pressed.size).toBe(0);

    input.borrowMouse("picker", false);
    expect(input.mouseButtons).toBe(true);
    input.controlUp("Mouse0");
    input.controlDown("Mouse0");
    expect([...input.sampleTick(0).pressed]).toEqual(["primary"]);
  });
});

describe("createInputState: resetEdges", () => {
  it("drops unseen presses, releases and click-to-move but keeps held controls", () => {
    const input = createInputState("moba");
    input.setAim({ x: 2, z: 3 });
    input.controlDown("KeyQ");
    input.controlDown("Mouse2");
    input.controlUp("Mouse2");
    input.resetEdges();

    const tick = input.sampleTick(0);
    expect(tick.pressed.size).toBe(0);
    expect(tick.released.size).toBe(0);
    expect(tick.moveCommand).toBeNull();
    expect([...tick.held]).toEqual(["ability1"]);
    expect(input.sampleFrame().pressed.size).toBe(0);
  });
});
