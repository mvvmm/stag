/**
 * Debug commands: the single source of dev keys, pane buttons and `__game.run(id)`. Later steps
 * add cheats (god mode, spawn enemy, …) as one `define` each. DOM-free.
 */

export type Command = {
  /** Stable id, e.g. `draw.toggle`; used by `__game.run(id)`. */
  id: string;
  label: string;
  /** Pane folder and cheat-sheet section. */
  group: string;
  /** Dev-keys-mode key as a `KeyboardEvent.code` (`KeyG`, `Space`, `Period`). */
  key?: string;
  run: () => void;
};

/** `KeyG` → `G`, `Digit1` → `1`, `Space` → `Space`, `Period` → `.`. */
export function keyLabel(code: string): string {
  const named: Record<string, string> = {
    Backquote: "`",
    Period: ".",
    Comma: ",",
    Slash: "/",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
  };
  return named[code] ?? code.replace(/^(Key|Digit)/, "");
}

export type CommandRegistry = ReturnType<typeof createCommandRegistry>;

export function createCommandRegistry() {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();

  return {
    /**
     * Adds a command, replacing one with the same id (module reloads). Throws if its key is
     * already taken by another command.
     */
    define(command: Command): void {
      const clash = [...commands.values()].find(
        (other) => command.key && other.key === command.key && other.id !== command.id,
      );
      if (clash) {
        throw new Error(
          `dev key ${command.key} is taken by "${clash.id}" (defining "${command.id}")`,
        );
      }
      commands.set(command.id, command);
      for (const listener of listeners) listener();
    },

    /** Runs a command by id. False if there's no such command. */
    run(id: string): boolean {
      const command = commands.get(id);
      command?.run();
      return !!command;
    },

    /** The command bound to a key, if any. */
    byKey(code: string): Command | undefined {
      for (const command of commands.values()) if (command.key === code) return command;
      return undefined;
    },

    list(): Command[] {
      return [...commands.values()];
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
