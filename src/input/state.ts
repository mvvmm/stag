import { normalizeClamp, rotateByYaw, type Vec2 } from "@/core/math";
import {
  ACTIONS,
  type Action,
  type AnyAction,
  type InputFrame,
  type ShellFrame,
} from "@/input/actions";
import {
  actionsByControl,
  type Control,
  PRESETS,
  type Preset,
  type PresetId,
} from "@/input/bindings";

type Direction = "up" | "down" | "left" | "right";
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

/** Edges collected for one consumer since it last sampled. */
type Latch = { pressed: Set<AnyAction>; released: Set<AnyAction> };

const newLatch = (): Latch => ({ pressed: new Set(), released: new Set() });

const GAME_ACTIONS: ReadonlySet<AnyAction> = new Set(ACTIONS);
const isAction = (action: AnyAction): action is Action => GAME_ACTIONS.has(action);

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
  const held = new Set<AnyAction>();
  const tickLatch = newLatch();
  const frameLatch = newLatch();
  /** The pointer-move control went down since the last tick (so a click shorter than a tick still moves). */
  let moveClicked = false;
  let aim: Vec2 = { x: 0, z: 0 };

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

  const actionHeld = (action: AnyAction): boolean => {
    for (const control of down) {
      if (bindings.get(control)?.includes(action)) return true;
    }
    return false;
  };

  const edge = (kind: "pressed" | "released", action: AnyAction) => {
    tickLatch[kind].add(action);
    frameLatch[kind].add(action);
  };

  const controlDown = (control: Control): void => {
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
    return active ? { x: aim.x, z: aim.z } : null;
  };

  return {
    controlDown,
    controlUp,
    releaseAll,

    /** True if the control means something in the current preset (so the DOM default can go). */
    isBound(control: Control): boolean {
      return bindings.has(control) || isMoveControl(control);
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

    /** Latest cursor position on the ground, set by the renderer each frame. */
    setAim(point: Vec2): void {
      aim = { x: point.x, z: point.z };
    },

    /**
     * Input for one simulation tick. `cameraYaw` turns the screen-relative WASD vector into a
     * world direction. Consumes the tick latch.
     */
    sampleTick(cameraYaw: number): InputFrame {
      const screen = { x: axis("left", "right"), z: axis("down", "up") };
      const frame: InputFrame = {
        move: normalizeClamp(rotateByYaw(screen, cameraYaw)),
        moveCommand: moveCommand(),
        aim: { x: aim.x, z: aim.z },
        held: new Set([...held].filter(isAction)),
        pressed: new Set([...tickLatch.pressed].filter(isAction)),
        released: new Set([...tickLatch.released].filter(isAction)),
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
