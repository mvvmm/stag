import type { JSX } from "preact";

// Placeholder ability icons, by the `icon` id in the ability's data: simple line drawings in
// `currentColor` until the art pass paints real ones.

const ICONS: Record<string, JSX.Element> = {
  /** Three claw slashes: the auto attack. */
  claw: (
    <>
      <path d="M7 4c-1 6 0 11 4 16" />
      <path d="M12 3c-1 6 0 11 4 17" />
      <path d="M17 4c-1 5 0 10 3 14" />
    </>
  ),
  /** A long bar thrown forward: a line skillshot. */
  line: (
    <>
      <path d="M4 20 18 6" />
      <path d="M13 6h5v5" />
      <path d="M7 21 21 7" opacity={0.4} />
    </>
  ),
  /** A ring with rays: an area burst. */
  burst: (
    <>
      <circle cx={12} cy={12} r={4.5} />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  /** A wedge from a point: a cone. */
  cone: (
    <>
      <path d="M4 20 20 6" />
      <path d="M4 20 18 20" />
      <path d="M20 6a16 16 0 0 1-2 14" />
    </>
  ),
  /** Crosshairs on a target: a targeted strike. */
  strike: (
    <>
      <circle cx={12} cy={12} r={7} />
      <circle cx={12} cy={12} r={2} />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </>
  ),
};

export function AbilityIcon({ icon, label }: { icon: string | null; label: string }) {
  const shape = icon ? ICONS[icon] : undefined;
  if (!shape) return <span aria-hidden="true">{label.slice(0, 1)}</span>;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
