import styles from "./softwareCursor.module.css";

// The game's cursors. While the pointer is locked (moba) the browser hides the real cursor and only
// reports movement, so the game draws one: positioned imperatively every frame (a transform, no
// re-render), which is why it isn't a Preact component reading a signal. Over an enemy it becomes
// the attack cursor, three claw marks centered on the pointer, in both schemes (unlocked, as the
// canvas's CSS cursor).

const ARROW = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
  <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill="#d8d2c4" stroke="#07080a" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

/** The attack cursor's size, px; its hotspot is its center. */
const CLAW_SIZE = 26;
const CLAW_MARKS = ["M7 4 C9 9 9 15 6 22", "M13 3 C15 9 15 16 12 23", "M19 4 C21 9 21 15 18 22"];
const CLAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" width="${CLAW_SIZE}" height="${CLAW_SIZE}" aria-hidden="true">
  <g fill="none" stroke-linecap="round">
    ${CLAW_MARKS.map((d) => `<path d="${d}" stroke="#07080a" stroke-width="4.6"/>`).join("")}
    ${CLAW_MARKS.map((d) => `<path d="${d}" stroke="#d9573f" stroke-width="2.2"/>`).join("")}
  </g>
</svg>`;
const CLAW_CSS = `url("data:image/svg+xml,${encodeURIComponent(CLAW)}") ${CLAW_SIZE / 2} ${CLAW_SIZE / 2}, crosshair`;

export function createSoftwareCursor(canvas: HTMLCanvasElement) {
  const element = document.createElement("div");
  element.className = styles.cursor ?? "";
  element.innerHTML = ARROW;
  element.style.display = "none";
  document.body.append(element);
  let shownAttack = false;
  let cssAttack = false;
  return {
    /**
     * Shows the drawn cursor at `at` (CSS pixels relative to the canvas), or hides it (null: the
     * browser's cursor is showing). `attack`: the pointer is over an enemy.
     */
    update(at: { x: number; y: number } | null, attack: boolean): void {
      const css = attack && !at;
      if (css !== cssAttack) {
        cssAttack = css;
        canvas.style.cursor = css ? CLAW_CSS : "";
      }
      if (!at) {
        element.style.display = "none";
        return;
      }
      if (attack !== shownAttack) {
        shownAttack = attack;
        element.innerHTML = attack ? CLAW : ARROW;
      }
      const rect = canvas.getBoundingClientRect();
      // The arrow's tip is its hotspot, the claw marks' center is theirs.
      const offset = attack ? CLAW_SIZE / 2 : 0;
      element.style.display = "block";
      element.style.transform = `translate(${rect.left + at.x - offset}px, ${rect.top + at.y - offset}px)`;
    },
  };
}
