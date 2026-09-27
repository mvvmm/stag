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
  /**
   * Changes the simulation (a cheat like "spawn enemy"). Such commands are recorded and replayed,
   * so `run` must only touch the current world through the shell. View-only commands (stats,
   * wireframe, …) leave it off.
   */
  sim?: boolean;
  run: () => void;
};

export type CommandRegistry = ReturnType<typeof createCommandRegistry>;

export function createCommandRegistry() {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();
  const beforeRun = new Set<(command: Command) => void>();

  return {
    /** Adds a command, replacing one with the same id (module reloads). */
    define(command: Command): void {
      commands.set(command.id, command);
      for (const listener of listeners) listener();
    },

    /** Runs a command by id (after the `onBeforeRun` listeners). False if there's no such command. */
    run(id: string): boolean {
      const command = commands.get(id);
      if (!command) return false;
      for (const listener of beforeRun) listener(command);
      command.run();
      return true;
    },

    /** Runs a command without telling `onBeforeRun` listeners (replay playback). */
    replay(id: string): boolean {
      const command = commands.get(id);
      command?.run();
      return !!command;
    },

    /** Called right before a command runs through `run` (the replay recorder watches sim commands). */
    onBeforeRun(listener: (command: Command) => void): () => void {
      beforeRun.add(listener);
      return () => beforeRun.delete(listener);
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
