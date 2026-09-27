import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "@/debug/commands";

describe("command registry", () => {
  it("runs commands by id", () => {
    const commands = createCommandRegistry();
    let count = 0;
    commands.define({ id: "a", label: "A", group: "g", run: () => count++ });

    expect(commands.run("a")).toBe(true);
    expect(count).toBe(1);
    expect(commands.run("missing")).toBe(false);
  });

  it("replaces a command with the same id", () => {
    const commands = createCommandRegistry();
    commands.define({ id: "a", label: "A", group: "g", run: () => {} });
    commands.define({ id: "a", label: "A2", group: "g", run: () => {} });
    expect(commands.list().map((c) => c.label)).toEqual(["A2"]);
  });

  it("lists only commands that want a pane button", () => {
    const commands = createCommandRegistry();
    commands.define({ id: "a", label: "A", group: "g", run: () => {} });
    commands.define({ id: "b", label: "B", group: "g", button: false, run: () => {} });
    expect(commands.buttons().map((c) => c.id)).toEqual(["a"]);
  });

  it("notifies on changes", () => {
    const commands = createCommandRegistry();
    let changes = 0;
    commands.onChange(() => changes++);
    commands.define({ id: "a", label: "A", group: "g", run: () => {} });
    expect(changes).toBe(1);
  });
});
