/**
 * Immediate-mode debug drawing. Any code, simulation systems included, can call
 * `debugDraw.line(...)` and friends; the renderer drains the buffer each frame. Write-only and a
 * no-op while disabled, so it never affects the simulation. DOM- and Babylon-free.
 *
 * Lifetimes:
 * - drawn during a tick (between `beginTick` and `endTick`): shown until the next tick, so it
 *   stays visible while paused
 * - drawn outside a tick (render code): shown for one frame
 * - with `duration` (seconds of game time): ages with the ticks, so pause and slow-mo freeze it
 */

export type Rgb = { r: number; g: number; b: number };

export const DEBUG_COLORS = {
  red: { r: 1, g: 0.3, b: 0.25 },
  green: { r: 0.35, g: 1, b: 0.4 },
  blue: { r: 0.35, g: 0.55, b: 1 },
  yellow: { r: 1, g: 0.9, b: 0.3 },
  cyan: { r: 0.3, g: 0.95, b: 1 },
  magenta: { r: 1, g: 0.35, b: 0.95 },
  white: { r: 1, g: 1, b: 1 },
  grey: { r: 0.45, g: 0.45, b: 0.45 },
} satisfies Record<string, Rgb>;

export type DebugColor = keyof typeof DEBUG_COLORS | Rgb;

/** A point on (or above) the ground plane; `y` defaults to just above the ground. */
export type DebugPoint = { x: number; z: number; y?: number };

export type DrawOptions = {
  color?: DebugColor;
  /** Groups shapes so they can be toggled together. Defaults to `general`. */
  category?: string;
  /** Seconds of game time to keep the shape. */
  duration?: number;
};

export type Vec3 = { x: number; y: number; z: number };
export type DebugSegment = { a: Vec3; b: Vec3; color: Rgb };
export type DebugLabel = { at: Vec3; text: string; color: Rgb };

type Shape = { category: string; segments: DebugSegment[]; label?: DebugLabel };
type Timed = Shape & { remaining: number };

/** Height used when a point has no `y`: just above the ground so lines don't z-fight it. */
export const DEFAULT_Y = 0.03;
const CIRCLE_SEGMENTS = 32;
const ARROW_HEAD = 0.25;
const POINT_SIZE = 0.15;

const toVec3 = (p: DebugPoint): Vec3 => ({ x: p.x, y: p.y ?? DEFAULT_Y, z: p.z });
const resolveColor = (color: DebugColor | undefined): Rgb =>
  color === undefined
    ? DEBUG_COLORS.white
    : typeof color === "string"
      ? DEBUG_COLORS[color]
      : color;

export type DebugDraw = ReturnType<typeof createDebugDraw>;

export function createDebugDraw() {
  let enabled = false;
  let inTick = false;
  const tickShapes: Shape[] = [];
  const frameShapes: Shape[] = [];
  const timedShapes: Timed[] = [];
  const categories = new Map<string, boolean>();

  const add = (segments: DebugSegment[], options: DrawOptions, label?: DebugLabel) => {
    const category = options.category ?? "general";
    if (!categories.has(category)) categories.set(category, true);
    const shape: Shape = { category, segments, label };
    if (options.duration !== undefined && options.duration > 0) {
      timedShapes.push({ ...shape, remaining: options.duration });
    } else {
      (inTick ? tickShapes : frameShapes).push(shape);
    }
  };

  const segment = (a: Vec3, b: Vec3, color: Rgb): DebugSegment => ({ a, b, color });

  const polyline = (points: readonly Vec3[], color: Rgb, closed: boolean): DebugSegment[] => {
    const segments: DebugSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push(segment(points[i] as Vec3, points[i + 1] as Vec3, color));
    }
    if (closed && points.length > 2) {
      segments.push(segment(points[points.length - 1] as Vec3, points[0] as Vec3, color));
    }
    return segments;
  };

  return {
    get enabled() {
      return enabled;
    },
    /** Turning drawing off also clears everything that's buffered. */
    set enabled(on: boolean) {
      enabled = on;
      if (!on) this.clear();
    },

    line(a: DebugPoint, b: DebugPoint, options: DrawOptions = {}): void {
      if (!enabled) return;
      add([segment(toVec3(a), toVec3(b), resolveColor(options.color))], options);
    },

    /** A line with a head at `to`, drawn in the ground plane. */
    arrow(from: DebugPoint, to: DebugPoint, options: DrawOptions = {}): void {
      if (!enabled) return;
      const color = resolveColor(options.color);
      const a = toVec3(from);
      const b = toVec3(to);
      const segments = [segment(a, b, color)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-6) {
        const head = Math.min(ARROW_HEAD, length * 0.5);
        const ux = dx / length;
        const uz = dz / length;
        for (const side of [-1, 1]) {
          // Back along the shaft and out to one side, at ±30°.
          const hx = -ux * Math.cos(Math.PI / 6) - side * uz * Math.sin(Math.PI / 6);
          const hz = -uz * Math.cos(Math.PI / 6) + side * ux * Math.sin(Math.PI / 6);
          segments.push(segment(b, { x: b.x + hx * head, y: b.y, z: b.z + hz * head }, color));
        }
      }
      add(segments, options);
    },

    /** A circle lying flat on the ground plane. */
    circle(center: DebugPoint, radius: number, options: DrawOptions = {}): void {
      if (!enabled) return;
      const c = toVec3(center);
      const points: Vec3[] = [];
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        points.push({
          x: c.x + Math.cos(angle) * radius,
          y: c.y,
          z: c.z + Math.sin(angle) * radius,
        });
      }
      add(polyline(points, resolveColor(options.color), true), options);
    },

    /** An axis-aligned wireframe box; `size` is the full extent. */
    box(center: DebugPoint, size: Vec3, options: DrawOptions = {}): void {
      if (!enabled) return;
      const color = resolveColor(options.color);
      const c = toVec3(center);
      const hx = size.x / 2;
      const hy = size.y / 2;
      const hz = size.z / 2;
      const corner = (i: number): Vec3 => ({
        x: c.x + (i & 1 ? hx : -hx),
        y: c.y + (i & 2 ? hy : -hy),
        z: c.z + (i & 4 ? hz : -hz),
      });
      const edges = [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7], // along x
        [0, 2],
        [1, 3],
        [4, 6],
        [5, 7], // along y
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7], // along z
      ] as const;
      add(
        edges.map(([i, j]) => segment(corner(i), corner(j), color)),
        options,
      );
    },

    /** A small cross marking a point. */
    point(at: DebugPoint, options: DrawOptions = {}): void {
      if (!enabled) return;
      const color = resolveColor(options.color);
      const p = toVec3(at);
      const s = POINT_SIZE;
      add(
        [
          segment({ ...p, x: p.x - s }, { ...p, x: p.x + s }, color),
          segment({ ...p, y: p.y - s }, { ...p, y: p.y + s }, color),
          segment({ ...p, z: p.z - s }, { ...p, z: p.z + s }, color),
        ],
        options,
      );
    },

    /** Connected line segments through `points`, optionally closed into a loop. */
    path(points: readonly DebugPoint[], options: DrawOptions & { closed?: boolean } = {}): void {
      if (!enabled) return;
      add(polyline(points.map(toVec3), resolveColor(options.color), !!options.closed), options);
    },

    /** A text label anchored at a world point. */
    text(at: DebugPoint, text: string, options: DrawOptions = {}): void {
      if (!enabled) return;
      add([], options, { at: toVec3(at), text, color: resolveColor(options.color) });
    },

    /** Call before each simulation tick: drops last tick's shapes and ages timed ones by `dt`. */
    beginTick(dt: number): void {
      inTick = true;
      tickShapes.length = 0;
      let kept = 0;
      for (const shape of timedShapes) {
        shape.remaining -= dt;
        if (shape.remaining > 0) timedShapes[kept++] = shape;
      }
      timedShapes.length = kept;
    },

    endTick(): void {
      inTick = false;
    },

    /** Call after rendering: drops the frame's shapes. */
    endFrame(): void {
      frameShapes.length = 0;
    },

    clear(): void {
      tickShapes.length = 0;
      frameShapes.length = 0;
      timedShapes.length = 0;
    },

    /** Categories seen so far, with whether each is shown. */
    get categories(): ReadonlyMap<string, boolean> {
      return categories;
    },

    setCategory(category: string, shown: boolean): void {
      categories.set(category, shown);
    },

    /** Everything currently visible, for the renderer. */
    collect(): { segments: DebugSegment[]; labels: DebugLabel[] } {
      const segments: DebugSegment[] = [];
      const labels: DebugLabel[] = [];
      for (const list of [tickShapes, frameShapes, timedShapes]) {
        for (const shape of list) {
          if (!categories.get(shape.category)) continue;
          for (const s of shape.segments) segments.push(s);
          if (shape.label) labels.push(shape.label);
        }
      }
      return { segments, labels };
    },
  };
}

/** The game's debug-draw buffer. The debug tools enable it; otherwise every call is a no-op. */
export const debugDraw = createDebugDraw();
