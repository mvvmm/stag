import { describe, expect, it } from "vitest";
import { createDebugDraw, DEBUG_COLORS, DEFAULT_Y } from "@/core/debugDraw";

const enabled = () => {
  const draw = createDebugDraw();
  draw.enabled = true;
  return draw;
};

describe("debugDraw", () => {
  it("does nothing while disabled", () => {
    const draw = createDebugDraw();
    draw.line({ x: 0, z: 0 }, { x: 1, z: 0 });
    draw.text({ x: 0, z: 0 }, "hi");
    expect(draw.collect()).toEqual({ segments: [], labels: [] });
    expect(draw.categories.size).toBe(0);
  });

  it("keeps shapes drawn during a tick until the next tick", () => {
    const draw = enabled();
    draw.beginTick(0.1);
    draw.line({ x: 0, z: 0 }, { x: 1, z: 0 });
    draw.endTick();

    // Several frames (e.g. while paused) still show it.
    draw.endFrame();
    draw.endFrame();
    expect(draw.collect().segments).toHaveLength(1);

    draw.beginTick(0.1);
    draw.endTick();
    expect(draw.collect().segments).toHaveLength(0);
  });

  it("keeps shapes drawn outside a tick for one frame", () => {
    const draw = enabled();
    draw.point({ x: 0, z: 0 });
    expect(draw.collect().segments).toHaveLength(3);
    draw.endFrame();
    expect(draw.collect().segments).toHaveLength(0);
  });

  it("ages timed shapes with game time only", () => {
    const draw = enabled();
    draw.line({ x: 0, z: 0 }, { x: 1, z: 0 }, { duration: 0.25 });

    for (let i = 0; i < 10; i++) draw.endFrame(); // paused frames don't age it
    draw.beginTick(0.1);
    draw.beginTick(0.1);
    expect(draw.collect().segments).toHaveLength(1);
    draw.beginTick(0.1);
    expect(draw.collect().segments).toHaveLength(0);
  });

  it("filters by category and remembers categories", () => {
    const draw = enabled();
    draw.line({ x: 0, z: 0 }, { x: 1, z: 0 }, { category: "pawn" });
    draw.text({ x: 0, z: 0 }, "hi");

    draw.setCategory("pawn", false);
    expect(draw.collect().segments).toHaveLength(0);
    expect(draw.collect().labels).toHaveLength(1);
    expect([...draw.categories]).toEqual([
      ["pawn", false],
      ["general", true],
    ]);

    draw.setCategory("pawn", true);
    expect(draw.collect().segments).toHaveLength(1);
  });

  it("clears the buffer when disabled", () => {
    const draw = enabled();
    draw.line({ x: 0, z: 0 }, { x: 1, z: 0 }, { duration: 5 });
    draw.enabled = false;
    draw.enabled = true;
    expect(draw.collect().segments).toHaveLength(0);
  });

  it("builds shapes from segments with colors and a default height", () => {
    const draw = enabled();
    draw.circle({ x: 0, z: 0 }, 1, { color: "red" });
    draw.box({ x: 0, y: 1, z: 0 }, { x: 2, y: 2, z: 2 });
    draw.arrow({ x: 0, z: 0 }, { x: 2, z: 0 }, { color: { r: 0, g: 0, b: 1 } });
    draw.path(
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
      { closed: true },
    );

    const { segments } = draw.collect();
    expect(segments).toHaveLength(32 + 12 + 3 + 3);
    const [first] = segments;
    expect(first?.color).toEqual(DEBUG_COLORS.red);
    expect(first?.a.y).toBe(DEFAULT_Y);
    // Circle points lie on the radius.
    for (const s of segments.slice(0, 32)) expect(Math.hypot(s.a.x, s.a.z)).toBeCloseTo(1);
    // Arrow head ends behind the tip.
    const heads = segments.slice(44, 47).slice(1);
    for (const s of heads) {
      expect(s.a).toEqual({ x: 2, y: DEFAULT_Y, z: 0 });
      expect(s.b.x).toBeLessThan(2);
    }
  });
});
