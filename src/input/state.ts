import { normalizeClamp, rotateByYaw, type Vec2 } from "@/core/math";
import type { Action, InputFrame, ShellFrame } from "@/input/actions";
import {
  actionsByControl,
  type Control,
  PRESETS,
  type Preset,
  type PresetId,
} from "@/input/bindings";
import { quantize, quantizeDown } from "@/input/quantize";

type Direction = "up" | "down" | "left" | "right";
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

/** Edges collected for one consumer since it last sampled. */
type Latch = { pressed: Set<Action>; released: Set<Action> };

const newLatch = (): Latch => ({ pressed: new Set(), released: new Set() });

const isMouseButton = (control: Control) => control.startsWith("Mouse");

export type InputState = ReturnType<typeof createInputState>;

/**
 * Turns raw control events into action state. DOM-free: `input/dom.ts` feeds it events, the
 * renderer feeds it the aim point, and two consumers read it with their own latched edges:
 * the simulation once per tick (`sampleTick`) and the shell once per frame (`sampleFrame`).
 * A press or release is reported to each consumer exactly once, however many ticks a frame runs.
 */
export function createInputState(initialPreset: PresetId) {
  let preset: Preset = PRESETS[initialPreset];
  let bindings = actionsByControl(preset);
  const down = new Set<Control>();
  const held = new Set<Action>();
  const tickLatch = newLatch();
  const frameLatch = newLatch();
  /** The pointer-move control went down since the last tick (so a click shorter than a tick still moves). */
  let moveClicked = false;
  let aim: Vec2 = { x: 0, z: 0 };
  let hover: number | null = null;
  /** Who borrowed the mouse (debug free camera, entity picker). While any has, buttons are ignored. */
  const mouseBorrowers = new Set<string>();

  // Last-pressed-wins per axis: each direction remembers when it was last pressed.
  let pressOrder = 0;
  const lastPressed: Record<Direction, number> = { up: 0, down: 0, left: 0, right: 0 };

  const directionOf = (control: Control): Direction | undefined => {
    if (preset.move.kind !== "keys") return undefined;
    const move = preset.move;
    return DIRECTIONS.find((direction) => move[direction].includes(control));
  };

  const isMoveControl = (control: Control): boolean =>
    preset.move.kind === "pointer" ? preset.move.control === control : !!directionOf(control);

  const directionHeld = (direction: Direction): boolean => {
    if (preset.move.kind !== "keys") return false;
    return preset.move[direction].some((control) => down.has(control));
  };

  /** -1, 0 or 1 along one axis; when both directions are held, the more recent press wins. */
  const axis = (negative: Direction, positive: Direction): number => {
    const neg = directionHeld(negative);
    const pos = directionHeld(positive);
    if (neg && pos) return lastPressed[positive] > lastPressed[negative] ? 1 : -1;
    return pos ? 1 : neg ? -1 : 0;
  };

  const actionHeld = (action: Action): boolean => {
    for (const control of down) {
      if (bindings.get(control)?.includes(action)) return true;
    }
    return false;
  };

  const edge = (kind: "pressed" | "released", action: Action) => {
    tickLatch[kind].add(action);
    frameLatch[kind].add(action);
  };

  const controlDown = (control: Control): void => {
    if (mouseBorrowers.size && isMouseButton(control)) return;
    if (down.has(control)) return; // key repeat or duplicate event
    down.add(control);
    const direction = directionOf(control);
    if (direction) lastPressed[direction] = ++pressOrder;
    if (preset.move.kind === "pointer" && preset.move.control === control) {
      moveClicked = true;
    }
    for (const action of bindings.get(control) ?? []) {
      if (held.has(action)) continue;
      held.add(action);
      edge("pressed", action);
    }
  };

  const controlUp = (control: Control): void => {
    if (!down.delete(control)) return;
    for (const action of bindings.get(control) ?? []) {
      if (!held.has(action) || actionHeld(action)) continue;
      held.delete(action);
      edge("released", action);
    }
  };

  /** Releases every held control (window blur, tab hidden, preset switch). */
  const releaseAll = (): void => {
    for (const control of [...down]) controlUp(control);
  };

  const moveCommand = (): Vec2 | null => {
    if (preset.move.kind !== "pointer") return null;
    const active = moveClicked || down.has(preset.move.control);
    return active ? { x: quantize(aim.x), z: quantize(aim.z) } : null;
  };

  return {
    controlDown,
    controlUp,
    releaseAll,

    /** True if the control means something in the current preset (so the DOM default can go). */
    isBound(control: Control): boolean {
      return bindings.has(control) || isMoveControl(control);
    },

    /** False while something else has borrowed the mouse buttons. */
    get mouseButtons(): boolean {
      return mouseBorrowers.size === 0;
    },

    /**
     * Borrows (or returns) the mouse buttons for a debug tool such as the free camera or the entity
     * picker. The game gets them back once every borrower has returned them. On borrowing, held
     * buttons are released (the next tick sees the releases); keys keep working.
     */
    borrowMouse(owner: string, borrowed: boolean): void {
      const wasFree = mouseBorrowers.size === 0;
      if (borrowed) mouseBorrowers.add(owner);
      else mouseBorrowers.delete(owner);
      if (wasFree && mouseBorrowers.size) {
        for (const control of [...down]) if (isMouseButton(control)) controlUp(control);
        moveClicked = false;
      }
    },

    /**
     * Drops presses and releases no tick or frame has seen yet, and a pending click-to-move (scene
     * reset). Physically held controls stay held.
     */
    resetEdges(): void {
      for (const latch of [tickLatch, frameLatch]) {
        latch.pressed.clear();
        latch.released.clear();
      }
      moveClicked = false;
    },

    get preset(): Preset {
      return preset;
    },

    /** Switches presets. Held controls are released first, so nothing carries over. */
    setPreset(id: PresetId): void {
      releaseAll();
      preset = PRESETS[id];
      bindings = actionsByControl(preset);
    },

    get aim(): Vec2 {
      return aim;
    },

    /** The body under the cursor (its `uid`), or null. */
    get hover(): number | null {
      return hover;
    },

    /** The body under the cursor (its `uid`), or null; set by the shell's screen pick each frame. */
    setHover(uid: number | null): void {
      hover = uid;
    },

    /** Latest cursor position on the ground, set by the renderer each frame. */
    setAim(point: Vec2): void {
      aim = { x: point.x, z: point.z };
    },

    /**
     * Input for one simulation tick. `cameraYaw` turns the screen-relative WASD vector into a
     * world direction. Positions and directions are quantized (see `quantize.ts`), so a replay
     * feeds the sim exactly what it saw live. Consumes the tick latch.
     */
    sampleTick(cameraYaw: number): InputFrame {
      const screen = { x: axis("left", "right"), z: axis("down", "up") };
      const move = normalizeClamp(rotateByYaw(screen, cameraYaw));
      const frame: InputFrame = {
        move: { x: quantizeDown(move.x), z: quantizeDown(move.z) },
        moveCommand: moveCommand(),
        aim: { x: quantize(aim.x), z: quantize(aim.z) },
        hover,
        held: new Set(held),
        pressed: new Set(tickLatch.pressed),
        released: new Set(tickLatch.released),
      };
      tickLatch.pressed.clear();
      tickLatch.released.clear();
      moveClicked = false;
      return frame;
    },

    /** Input for the shell, once per render frame (works while the loop is paused). */
    sampleFrame(): ShellFrame {
      const frame: ShellFrame = { held: new Set(held), pressed: new Set(frameLatch.pressed) };
      frameLatch.pressed.clear();
      frameLatch.released.clear();
      return frame;
    },
  };
}
