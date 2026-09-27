import { describe, expect, it } from "vitest";
import { createSceneRegistry } from "@/scenes/registry";

const a = { id: "a" };
const b = { id: "b" };

describe("createSceneRegistry", () => {
  it("looks scenes up by id and keeps their order", () => {
    const registry = createSceneRegistry([a, b], "b");
    expect(registry.list()).toEqual([a, b]);
    expect(registry.get("a")).toBe(a);
    expect(registry.get("c")).toBeUndefined();
    expect(registry.default).toBe(b);
  });

  it("resolves missing ids to the default and flags unknown ones", () => {
    const registry = createSceneRegistry([a, b], "a");
    expect(registry.resolve("b")).toEqual({ scene: b, unknown: false });
    expect(registry.resolve(null)).toEqual({ scene: a, unknown: false });
    expect(registry.resolve("nope")).toEqual({ scene: a, unknown: true });
  });

  it("rejects duplicate ids and an unregistered default", () => {
    expect(() => createSceneRegistry([a, { id: "a" }], "a")).toThrow("duplicate");
    expect(() => createSceneRegistry([a], "b")).toThrow("default");
  });
});
