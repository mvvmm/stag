import { describe, expect, it } from "vitest";
import { actionsByControl, MMO_PRESET, MOBA_PRESET, MOBA_SLOT_KEYS } from "@/input/bindings";

describe("bindings", () => {
  it("gives every moba slot key a quick cast, a Shift normal cast and an Alt self cast", () => {
    const byControl = actionsByControl(MOBA_PRESET);
    const keys = Object.entries(MOBA_SLOT_KEYS);
    expect(keys.map(([, key]) => key).sort()).toEqual(
      ["KeyD", "KeyE", "KeyF", "KeyQ", "KeyR", "KeyW"].sort(),
    );
    for (const [slot, key] of keys) {
      expect(byControl.get(key)).toEqual([slot]);
      expect(byControl.get(`Shift+${key}`)?.sort()).toEqual([slot, "normalCast"].sort());
      expect(byControl.get(`Alt+${key}`)?.sort()).toEqual([slot, "selfCast"].sort());
    }
  });

  it("uses the cast-mode actions only in slot chords", () => {
    const chords = Object.values(MOBA_SLOT_KEYS);
    expect(MOBA_PRESET.actions.normalCast).toEqual(chords.map((key) => `Shift+${key}`));
    expect(MOBA_PRESET.actions.selfCast).toEqual(chords.map((key) => `Alt+${key}`));
  });

  it("binds no dodge: Space and F mean something else in both presets", () => {
    expect(actionsByControl(MOBA_PRESET).get("Space")).toEqual(["centerCamera"]);
    expect(actionsByControl(MOBA_PRESET).get("KeyF")).toEqual(["extra2"]);
    expect(actionsByControl(MMO_PRESET).get("Space")).toBeUndefined();
    expect(actionsByControl(MMO_PRESET).get("KeyF")).toEqual(["interact"]);
  });
});
