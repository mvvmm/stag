import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const CROSS_ORIGIN_ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const FIXTURES = fileURLToPath(new URL("./src/replay/fixtures/", import.meta.url));

/** The commit replays are recorded on, and whether the tree had uncommitted changes. */
function gitInfo(): { commit: string; dirty: boolean } {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

const FIXTURE_SUFFIX = ".replay.json.gz";

/**
 * Dev server only, for the debug pane's replay fixtures (the checked-in headless tests):
 * - `POST /__replay/save?name=<name>[&overwrite=1]` writes the request body to
 *   `src/replay/fixtures/<name>.replay.json.gz` ("Save as test…"); 409 when it exists and
 *   overwrite isn't set
 * - `GET /__replay/list` lists the fixture names, `GET /__replay/fixture?name=<name>` sends one
 * Served here rather than imported, so production builds never bundle fixtures.
 */
function replayFixtures(): Plugin {
  return {
    name: "replay-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__replay/list", (_req, res) => {
        const names = existsSync(FIXTURES)
          ? readdirSync(FIXTURES)
              .filter((file) => file.endsWith(FIXTURE_SUFFIX))
              .map((file) => file.slice(0, -FIXTURE_SUFFIX.length))
          : [];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(names));
      });
      server.middlewares.use("/__replay/fixture", (req, res) => {
        const name = new URL(req.url ?? "", "http://localhost").searchParams.get("name") ?? "";
        const file = `${FIXTURES}${name}${FIXTURE_SUFFIX}`;
        if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) {
          res.statusCode = 404;
          res.end("no such fixture");
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(file));
      });
      server.middlewares.use("/__replay/save", (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const name = url.searchParams.get("name") ?? "";
        const reply = (status: number, text: string) => {
          res.statusCode = status;
          res.end(text);
        };
        if (req.method !== "POST") return reply(405, "POST only");
        if (!/^[a-z0-9-]+$/.test(name)) return reply(400, "name must be [a-z0-9-]+");
        const file = `${FIXTURES}${name}${FIXTURE_SUFFIX}`;
        if (existsSync(file) && url.searchParams.get("overwrite") !== "1") {
          return reply(409, "exists");
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          mkdirSync(FIXTURES, { recursive: true });
          writeFileSync(file, Buffer.concat(chunks));
          reply(200, `src/replay/fixtures/${name}${FIXTURE_SUFFIX}`);
        });
      });
    },
  };
}

const git = gitInfo();

export default defineConfig({
  // No react → preact/compat alias: we don't use React, and the Babylon Inspector needs the real one.
  // cloudflare(): the Worker is configured in cloudflare.config.ts (no entrypoint = assets-only);
  // the build lands where cf deploys it from, and dev applies public/_headers like production.
  // Left out under Vitest: tests are plain Node, and the plugin's server clashes with Vitest's.
  plugins: [
    preact({ reactAliasesEnabled: false }),
    replayFixtures(),
    process.env.VITEST
      ? []
      : cloudflare({ experimental: { newConfig: true, headersAndRedirectsDevModeSupport: true } }),
  ],
  define: {
    __COMMIT__: JSON.stringify(git.commit),
    __DIRTY__: JSON.stringify(git.dirty),
  },
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
