import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

const CROSS_ORIGIN_ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // No react → preact/compat alias: we don't use React, and the Babylon Inspector needs the real one.
  plugins: [preact({ reactAliasesEnabled: false })],
  // 5746 = "STAG" (5=S, 7=T, 4=A, 6=G). Cross-origin isolation gives performance.now() ~5 µs
  // resolution instead of 100 µs, which the debug profiler needs for sub-millisecond phases.
  server: { port: 5746, strictPort: true, headers: CROSS_ORIGIN_ISOLATION },
  preview: { port: 5746, headers: CROSS_ORIGIN_ISOLATION },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
