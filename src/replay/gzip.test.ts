import { describe, expect, it } from "vitest";
import { gzip, isGzip, readText } from "@/replay/gzip";

describe("gzip", () => {
  it("round-trips text and reads plain text as is", async () => {
    const text = JSON.stringify({ hello: "wörld", n: [1, 2, 3] }).repeat(50);
    const packed = await gzip(text);
    expect(isGzip(packed)).toBe(true);
    expect(packed.length).toBeLessThan(text.length / 5);
    expect(await readText(packed)).toBe(text);
    expect(await readText(new TextEncoder().encode(text))).toBe(text);
  });
});
