import type { Scene } from "@babylonjs/core";

/**
 * The Babylon Inspector, loaded on first open. Only in `pnpm dev` builds: the Inspector imports
 * Babylon's root barrel, which drags ~380 KB (gzipped) of otherwise unused core modules into the
 * chunks players download, even behind a dynamic import. Revisit with deep imports (9.6).
 * Not remembered across reloads: opening it is always an explicit choice.
 */
export function createInspector(scene: Scene) {
  let token: { dispose(): void } | null = null;
  let loading = false;

  return {
    available: import.meta.env.DEV,

    get open(): boolean {
      return token !== null || loading;
    },

    async toggle(): Promise<void> {
      if (!import.meta.env.DEV) {
        console.info("The Babylon Inspector is only available in `pnpm dev` builds.");
        return;
      }
      if (loading) return;
      if (token) {
        token.dispose();
        token = null;
        return;
      }
      loading = true;
      try {
        const { ShowInspector } = await import("@babylonjs/inspector");
        token = ShowInspector(scene);
      } finally {
        loading = false;
      }
    },
  };
}
