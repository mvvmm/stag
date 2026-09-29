import { describe, expect, it } from "vitest";
import { defaultDebugSettings, parseDebugSettings } from "@/debug/persist";

describe("parseDebugSettings", () => {
  it("returns defaults for missing, broken or foreign data", () => {
    const defaults = defaultDebugSettings();
    expect(parseDebugSettings(null)).toEqual(defaults);
    expect(parseDebugSettings("{not json")).toEqual(defaults);
    expect(parseDebugSettings("[1,2]")).toEqual(defaults);
    expect(parseDebugSettings(JSON.stringify({ v: 2, wireframe: true }))).toEqual(defaults);
  });

  it("round-trips valid settings", () => {
    const settings = {
      ...defaultDebugSettings(),
      paneFolders: { Debug: false, Tunables: true },
      stats: "full" as const,
      draw: { categories: { pawn: false } },
      wireframe: true,
      inputOverlay: false,
      atmosphere: false,
      valueView: true,
      standIns: true,
      hitboxes: true,
      tunables: { "pawn.speed": 7.5 },
      scene: "stress",
    };
    expect(parseDebugSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("falls back field by field", () => {
    const parsed = parseDebugSettings(
      JSON.stringify({
        v: 1,
        inputOverlay: "yes",
        atmosphere: 0,
        stats: "huge",
        paneFolders: { a: true, b: 3 },
        draw: { enabled: true, categories: "x" },
        tunables: [1],
        scene: 3,
      }),
    );
    expect(parsed).toEqual({
      ...defaultDebugSettings(),
      paneFolders: { a: true },
      draw: { categories: {} },
    });
  });
});
