import { describe, expect, it } from "vitest";
import { createDisposer } from "@/core/disposer";

describe("createDisposer", () => {
  it("runs cleanups newest first, once", () => {
    const disposer = createDisposer();
    const calls: string[] = [];
    disposer.add(() => calls.push("a"));
    disposer.own({ dispose: () => calls.push("b") });
    disposer.add(() => calls.push("c"));

    disposer.dispose();
    disposer.dispose();

    expect(calls).toEqual(["c", "b", "a"]);
    expect(disposer.disposed).toBe(true);
  });

  it("returns owned things", () => {
    const disposer = createDisposer();
    const thing = { dispose: () => {} };
    expect(disposer.own(thing)).toBe(thing);
  });

  it("runs cleanups added after disposal right away", () => {
    const disposer = createDisposer();
    disposer.dispose();
    const calls: string[] = [];
    disposer.add(() => calls.push("late"));
    expect(calls).toEqual(["late"]);
  });

  it("keeps going when a cleanup throws, then rethrows the first error", () => {
    const disposer = createDisposer();
    const calls: string[] = [];
    disposer.add(() => calls.push("a"));
    disposer.add(() => {
      throw new Error("first");
    });
    disposer.add(() => {
      throw new Error("second");
    });

    expect(() => disposer.dispose()).toThrow("second");
    expect(calls).toEqual(["a"]);
  });
});
