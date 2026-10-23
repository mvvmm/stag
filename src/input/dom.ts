import { DEBUG } from "@/debug/enabled";
import { DEFAULT_PRESET, isPresetId, type PresetId } from "@/input/bindings";
import type { InputState } from "@/input/state";

const PRESET_STORAGE_KEY = "druid.inputPreset";

/** `MouseEvent.buttons` bit → `MouseEvent.button` number (the middle and right bits are swapped). */
const BUTTON_BY_BIT = [0, 2, 1, 3, 4];

/** Input types that don't take typed text (a focused checkbox or slider still lets keys through). */
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "color",
]);

/**
 * Typing into a text field (the debug pane, the Inspector) must not drive the game or dev keys.
 * Other focused controls (checkboxes, buttons, dropdowns) don't count: the game keeps its keys,
 * and handling a bound key cancels its default, so a focused dropdown doesn't pick by letter.
 */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type))
  );
}

/**
 * Feeds DOM keyboard and mouse events into an `InputState`. The only DOM-aware input code.
 * Keys are read on the window; mouse buttons must go down on the canvas but release anywhere.
 *
 * In the moba scheme a click on the canvas locks the pointer (Pointer Lock), so the cursor can't
 * leave the window and the camera can pan at its edges, like League. While locked the browser
 * hides the cursor and only reports movement: `pointer` becomes a virtual cursor moved by it and
 * kept inside the canvas (the UI draws it). Esc (the browser's) or switching to WASD, or a debug
 * tool borrowing the mouse, lets go.
 */
export function attachInputDom(input: InputState, canvas: HTMLCanvasElement) {
  /** Last pointer position in CSS pixels relative to the canvas; null until it's been seen. */
  let pointer: { x: number; y: number } | null = null;
  let locked = false;
  /** Whether the pointer should be locked when the canvas is clicked. */
  const lockWanted = () => input.preset.move.kind === "pointer" && input.mouseButtons;
  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
  };
  const requestLock = () => {
    try {
      // A promise in current browsers (rejected when refused), undefined in older ones.
      const pending = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      pending?.catch?.(() => {});
    } catch {
      // Not allowed right now (e.g. just after Esc): the next click tries again.
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Leave browser shortcuts alone. On macOS, keys pressed with Cmd held never get a keyup, so
    // registering them would leave them stuck; release everything when Cmd goes down instead.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      if (event.key === "Meta") releaseAll();
      return;
    }
    if (isEditable(event.target) || !input.isBound(event.code)) return;
    event.preventDefault();
    if (!event.repeat) input.controlDown(event.code);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (input.isBound(event.code)) event.preventDefault();
    input.controlUp(event.code);
  };

  // Mouse buttons come from pointer events (Babylon cancels pointerdown, which suppresses the
  // legacy mouse events). A button pressed while another is held only fires pointermove, so
  // every pointer event diffs the `buttons` bitmask instead of trusting `event.button`.
  let buttons = 0;
  const onPointer = (event: PointerEvent) => {
    // Opening a dropdown lets go of everything: its native list swallows every key event while
    // it's open, so a key released meanwhile would otherwise stay held.
    if (event.type === "pointerdown" && event.target instanceof HTMLSelectElement) releaseAll();
    const rect = canvas.getBoundingClientRect();
    if (locked && pointer) {
      pointer = {
        x: Math.min(Math.max(pointer.x + event.movementX, 0), rect.width),
        y: Math.min(Math.max(pointer.y + event.movementY, 0), rect.height),
      };
    } else if (!locked) {
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    if (event.type === "pointerdown" && event.target === canvas && !locked && lockWanted()) {
      requestLock();
    }

    const changed = event.buttons ^ buttons;
    if (!changed) return;
    for (let bit = 0; bit < BUTTON_BY_BIT.length; bit++) {
      const mask = 1 << bit;
      if (!(changed & mask)) continue;
      const control = `Mouse${BUTTON_BY_BIT[bit]}`;
      if (event.buttons & mask) {
        // Presses only count on the canvas (not on UI panels); releases count anywhere.
        if (event.target !== canvas) continue;
        buttons |= mask;
        input.controlDown(control);
      } else {
        buttons &= ~mask;
        input.controlUp(control);
      }
    }
  };

  const onContextMenu = (event: Event) => event.preventDefault();

  // Nothing stays held while the game can't see the key or button come back up.
  const releaseAll = () => {
    buttons = 0;
    input.releaseAll();
  };
  const onBlur = releaseAll;
  const onVisibilityChange = () => {
    if (document.hidden) releaseAll();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", onPointer);
  window.addEventListener("pointerup", onPointer);
  window.addEventListener("pointercancel", onPointer);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("pointerlockchange", onLockChange);

  return {
    get pointer() {
      return pointer;
    },
    /** Whether the pointer is locked to the canvas (`pointer` is then the virtual cursor). */
    get locked() {
      return locked;
    },
    /** Lets go of the pointer lock once it's no longer wanted (WASD, a debug tool has the mouse). */
    syncLock(): void {
      if (locked && !lockWanted()) document.exitPointerLock();
    },
    detach() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onPointer);
      window.removeEventListener("pointercancel", onPointer);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerlockchange", onLockChange);
    },
  };
}

/**
 * The control preset to start with: the default (right-click) for players; in debug builds the one
 * last picked in the pane, when there is one.
 */
export function loadPreset(): PresetId {
  if (!DEBUG) return DEFAULT_PRESET;
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    return isPresetId(stored) ? stored : DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

export function savePreset(id: PresetId): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, id);
  } catch {
    // Storage blocked (private mode etc.): the preset just isn't remembered.
  }
}
