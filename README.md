# stag

A dark-fantasy druid roguelite for the browser (codename). You play a lone druid fighting through a corrupted wild in short runs: commit to a shapeshift form, pick a loadout, and watch your abilities mutate into a build unique to that run.

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

## License

All rights reserved. The source is public for reading, not reuse; see [LICENSE](LICENSE). Third-party assets are listed in [CREDITS.md](CREDITS.md).
