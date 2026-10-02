// Static-assets-only Worker: no entrypoint, Cloudflare serves the Vite build directly (the
// directory comes from Vite via @cloudflare/vite-plugin, see vite.config.ts).
// Deployed by Workers Builds with the cf CLI (main → production, other branches → Worker
// Previews, identical to production); see AGENTS.md.
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "stag",
    compatibilityDate: "2026-09-27",
    // Workers Logs + automatic tracing, everything sampled (traffic is tiny). Asset-only requests
    // never invoke a script, so these fill up once the Worker gets code (API, D1 in Phase 14).
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 1 },
    },
  },
});
