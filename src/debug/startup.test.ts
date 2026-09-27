import { describe, expect, it } from "vitest";
import { parseSeed, resolveStartup } from "@/debug/startup";

describe("parseSeed", () => {
  it("accepts decimal uint32s", () => {
    expect(parseSeed("0")).toBe(0);
    expect(parseSeed(" 123 ")).toBe(123);
    expect(parseSeed("4294967295")).toBe(4294967295);
  });

  it("rejects everything else", () => {
    for (const text of [null, undefined, "", "-1", "1.5", "0x10", "abc", "4294967296", "1e3"]) {
      expect(parseSeed(text)).toBeNull();
    }
  });
});

describe("resolveStartup", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("uses the URL first, then the remembered scene, with a fresh seed", () => {
    expect(resolveStartup(params("?scene=stress&seed=42"), "input-test", 7)).toEqual({
      sceneId: "stress",
      seed: 42,
      invalidSeed: null,
    });
    expect(resolveStartup(params(""), "stress", 7)).toEqual({
      sceneId: "stress",
      seed: 7,
      invalidSeed: null,
    });
    expect(resolveStartup(params(""), undefined, 7).sceneId).toBeUndefined();
  });

  it("falls back to the fresh seed and reports an invalid seed", () => {
    expect(resolveStartup(params("?seed=banana"), undefined, 7)).toEqual({
      sceneId: undefined,
      seed: 7,
      invalidSeed: "banana",
    });
  });
});
