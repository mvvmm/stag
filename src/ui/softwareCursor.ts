import styles from "./softwareCursor.module.css";

// The cursor drawn by the game while the pointer is locked (moba): the browser hides the real one
// and only reports movement. Positioned imperatively every frame (a transform, no re-render), which
// is why it isn't a Preact component reading a signal.

const ARROW = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
  <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill="#d8d2c4" stroke="#07080a" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

export function createSoftwareCursor(canvas: HTMLCanvasElement) {
  const element = document.createElement("div");
  element.className = styles.cursor ?? "";
  element.innerHTML = ARROW;
  element.style.display = "none";
  document.body.append(element);
  return {
    /** Shows the cursor at `at` (CSS pixels relative to the canvas), or hides it (null). */
    update(at: { x: number; y: number } | null): void {
      if (!at) {
        element.style.display = "none";
        return;
      }
      const rect = canvas.getBoundingClientRect();
      element.style.display = "block";
      element.style.transform = `translate(${rect.left + at.x}px, ${rect.top + at.y}px)`;
    },
  };
}
