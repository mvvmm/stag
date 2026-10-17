# stag

Early days: this is the foundation (engine shell, input, dev tools, record & replay), not a game yet.

**Play:** https://stag.root-mvm.workers.dev (desktop browser with WebGPU; add `?debug` for the dev tools)

## Stack

Babylon.js (WebGPU only) · TypeScript (strict) · Vite · Preact overlay · miniplex ECS · Vitest · Biome · Cloudflare Workers static assets

## Development

Node 24 and pnpm.

```sh
pnpm install
pnpm dev     # http://localhost:5746
pnpm check   # typecheck + lint/format + tests (required on every PR)
```

[AGENTS.md](AGENTS.md) has the commands, architecture rules and workflow. The design lives in [`slopdocs/`](slopdocs/), and the build story, step by step, in [`devlog/`](devlog/README.md).

## Deployment

Workers Builds deploys `main` to production and PR branches to Worker Previews. With
`cf@1.0.0-beta.18`, previews use build command `pnpm typecheck` and deploy command
`pnpm exec cf previews deploy`. cf builds the preview and writes both the stable branch
URL and the deployment URL for Builds to report on the PR; no output-file wrapper is needed.
Apply the deploy-command setting to existing previews too when upgrading.

The Worker currently serves static assets and has no secret bindings. If secrets are added,
use `bindings.secret()`; cf preserves existing preview secrets automatically. Preview-specific
`unsafe:inherit` bindings can break fresh previews.

Before merging, check a fresh preview and a redeployment: both URLs appear in the Builds
report, the branch URL serves the latest deployment, the game renders with cross-origin
isolation, and app checks pass. Check secret availability if the Worker uses secrets.

## License

All rights reserved. The source is public for reading, not reuse; see [LICENSE](LICENSE). Third-party assets are listed in [CREDITS.md](CREDITS.md).
