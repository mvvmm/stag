import { describe, expect, it } from "vitest";
import { fromQuantUnits, QUANT, quantize, quantizeDown, toQuantUnits } from "@/input/quantize";

describe("quantize", () => {
  it("snaps to the 1/1024 grid and round-trips through integer units exactly", () => {
    for (const value of [0, 1, -1, 0.1, Math.SQRT1_2, -3.25, 1234.5678]) {
      const q = quantize(value);
      expect(Math.abs(q - value)).toBeLessThanOrEqual(0.5 / QUANT);
      expect(Number.isInteger(toQuantUnits(q))).toBe(true);
      expect(fromQuantUnits(toQuantUnits(q))).toBe(q);
      expect(quantize(q)).toBe(q);
    }
  });

  it("never produces -0", () => {
    expect(Object.is(quantize(-0), 0)).toBe(true);
    expect(Object.is(quantize(-0.0001), 0)).toBe(true);
    expect(Object.is(quantizeDown(-0.0001), 0)).toBe(true);
    expect(Object.is(fromQuantUnits(-0), 0)).toBe(true);
  });

  it("rounds toward zero with quantizeDown, so directions don't grow", () => {
    const d = quantizeDown(Math.SQRT1_2);
    expect(d).toBeLessThanOrEqual(Math.SQRT1_2);
    expect(Math.hypot(d, d)).toBeLessThanOrEqual(1);
    expect(quantizeDown(-Math.SQRT1_2)).toBe(-d);
  });
});
