/**
 * Whether the dev tools are available: always in `pnpm dev`, and in production builds only with
 * `?debug` in the URL. Without it, players never download the tools and debug draw stays a no-op.
 */
export const DEBUG: boolean =
  import.meta.env.DEV || new URLSearchParams(location.search).has("debug");
