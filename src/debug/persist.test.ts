import { describe, expect, it } from "vitest";
import { defaultDebugSettings, parseDebugSettings } from "@/debug/persist";

describe("parseDebugSettings", () => {
  it("returns defaults for missing, broken or foreign data", () => {
    const defaults = defaultDebugSettings();
    expect(parseDebugSettings(null)).toEqual(defaults);
    expect(parseDebugSettings("{not json")).toEqual(defaults);
    expect(parseDebugSettings("[1,2]")).toEqual(defaults);
    expect(parseDebugSettings(JSON.stringify({ v: 2, devMode: true }))).toEqual(defaults);
  });

  it("round-trips valid settings", () => {
    const settings = {
      ...defaultDebugSettings(),
      devMode: true,
      paneOpen: true,
      paneFolders: { Tunables: true },
      stats: "full" as const,
      draw: { enabled: true, categories: { pawn: false } },
      wireframe: true,
      tunables: { "pawn.speed": 7.5 },
    };
    expect(parseDebugSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("falls back field by field", () => {
    const parsed = parseDebugSettings(
      JSON.stringify({
        v: 1,
        devMode: "yes",
        stats: "huge",
        paneFolders: { a: true, b: 3 },
        draw: { enabled: true, categories: "x" },
        tunables: [1],
      }),
    );
    expect(parsed).toEqual({
      ...defaultDebugSettings(),
      paneFolders: { a: true },
      draw: { enabled: true, categories: {} },
    });
  });
});
