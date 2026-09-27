/**
 * Debug commands: named actions the debug pane shows as buttons and `__game.run(id)` runs from
 * the console or agent-browser. Later steps add cheats (god mode, spawn enemy, …) as one `define`
 * each. There are no dev keybinds: the keyboard always belongs to the game. DOM-free.
 */

export type Command = {
  /** Stable id, e.g. `draw.toggle`; used by `__game.run(id)`. */
  id: string;
  label: string;
  /** Section in the pane's Commands folder. */
  group: string;
  /**
   * Whether the pane shows a button for it (default true). Off for commands that already have a
   * dedicated pane control, like a checkbox.
   */
  button?: boolean;
  run: () => void;
};

export type CommandRegistry = ReturnType<typeof createCommandRegistry>;

export function createCommandRegistry() {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();

  return {
    /** Adds a command, replacing one with the same id (module reloads). */
    define(command: Command): void {
      commands.set(command.id, command);
      for (const listener of listeners) listener();
    },

    /** Runs a command by id. False if there's no such command. */
    run(id: string): boolean {
      const command = commands.get(id);
      command?.run();
      return !!command;
    },

    list(): Command[] {
      return [...commands.values()];
    },

    /** Commands that get a button in the pane. */
    buttons(): Command[] {
      return [...commands.values()].filter((command) => command.button !== false);
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
