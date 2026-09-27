import { describe, expect, it } from "vitest";
import { createCommandRegistry, keyLabel } from "@/debug/commands";

describe("command registry", () => {
  it("runs commands by id and finds them by key", () => {
    const commands = createCommandRegistry();
    let count = 0;
    commands.define({ id: "a", label: "A", group: "g", key: "KeyG", run: () => count++ });

    expect(commands.run("a")).toBe(true);
    commands.byKey("KeyG")?.run();
    expect(count).toBe(2);
    expect(commands.run("missing")).toBe(false);
    expect(commands.byKey("KeyH")).toBeUndefined();
  });

  it("throws on a key clash, but lets a command be redefined", () => {
    const commands = createCommandRegistry();
    commands.define({ id: "a", label: "A", group: "g", key: "KeyG", run: () => {} });
    commands.define({ id: "a", label: "A2", group: "g", key: "KeyG", run: () => {} });
    expect(commands.list().map((c) => c.label)).toEqual(["A2"]);

    expect(() =>
      commands.define({ id: "b", label: "B", group: "g", key: "KeyG", run: () => {} }),
    ).toThrow(/KeyG/);
    commands.define({ id: "c", label: "C", group: "g", run: () => {} }); // no key: fine
  });

  it("notifies on changes", () => {
    const commands = createCommandRegistry();
    let changes = 0;
    commands.onChange(() => changes++);
    commands.define({ id: "a", label: "A", group: "g", run: () => {} });
    expect(changes).toBe(1);
  });
});

describe("keyLabel", () => {
  it("shortens key codes", () => {
    expect(keyLabel("KeyG")).toBe("G");
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("Period")).toBe(".");
    expect(keyLabel("Backquote")).toBe("`");
  });
});
