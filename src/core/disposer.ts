export type Disposable = { dispose(): void };

export type Disposer = ReturnType<typeof createDisposer>;

/**
 * Collects cleanups and runs them all at once, newest first (so things are torn down in the
 * reverse order they were set up). Cleanups added after `dispose()` run immediately.
 */
export function createDisposer() {
  const cleanups: (() => void)[] = [];
  let disposed = false;

  const add = (cleanup: () => void): void => {
    if (disposed) cleanup();
    else cleanups.push(cleanup);
  };

  return {
    get disposed(): boolean {
      return disposed;
    },

    add,

    /** Tracks something with a `dispose()` method and returns it. */
    own<T extends Disposable>(thing: T): T {
      add(() => thing.dispose());
      return thing;
    },

    /**
     * Runs every cleanup, newest first. One failing cleanup doesn't stop the others; the first
     * error is rethrown at the end. Calling it again does nothing.
     */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let failed = false;
      let firstError: unknown;
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
      cleanups.length = 0;
      if (failed) throw firstError;
    },
  };
}
