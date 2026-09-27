import { DEFAULT_PRESET, isPresetId, type PresetId } from "@/input/bindings";
import type { InputState } from "@/input/state";

const PRESET_STORAGE_KEY = "druid.inputPreset";

/** `MouseEvent.buttons` bit → `MouseEvent.button` number (the middle and right bits are swapped). */
const BUTTON_BY_BIT = [0, 2, 1, 3, 4];

/** Typing into a text field (the debug pane, the Inspector) must not drive the game or dev keys. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Feeds DOM keyboard and mouse events into an `InputState`. The only DOM-aware input code.
 * Keys are read on the window; mouse buttons must go down on the canvas but release anywhere.
 */
export function attachInputDom(input: InputState, canvas: HTMLCanvasElement) {
  /** Last pointer position in CSS pixels relative to the canvas; null until it's been seen. */
  let pointer: { x: number; y: number } | null = null;

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
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };

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

  return {
    get pointer() {
      return pointer;
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
    },
  };
}

/** The remembered control preset, or the default when storage is empty or unavailable. */
export function loadPreset(): PresetId {
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
