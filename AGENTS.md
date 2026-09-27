# AGENTS.md

Dark-fantasy druid roguelite for the browser. Babylon.js (WebGPU only) + TypeScript (strict) + Vite.

## Docs (`slopdocs/`)

- Core game design (style & mechanics): [slopdocs/core-game-design.md](slopdocs/core-game-design.md)
- Implementation plan (step order): [slopdocs/implementation-plan.md](slopdocs/implementation-plan.md)
- Misc thoughts (undecided ideas): [slopdocs/misc-thoughts.md](slopdocs/misc-thoughts.md)
- Step plans: [slopdocs/plans/](slopdocs/plans/)
  - **Every implementation step gets its own plan** before any code is written, named `<step>-<slug>.md` (e.g. [`0.1-project-scaffold.md`](slopdocs/plans/0.1-project-scaffold.md)).
  - Write it by interviewing the user (one question at a time) until the plan is solid. Record decisions, defaults picked, steps and acceptance criteria.
  - Link the plan from its step in `implementation-plan.md`, and tick the step there when it's done.

## Devlog (`devlog/`)

- One entry per step in `devlog/<step>-<slug>/index.md`: what we built, key decisions and why, surprises, and screenshots. Template and procedures: [devlog/README.md](devlog/README.md).
- **Finishing a step includes its devlog entry.** Write it from the plan, the commits and the session, take screenshots with agent-browser (look at each one before using it; more for art/atmosphere steps), add it to the index, and commit it with the step.
- Videos are optional and recorded by the user; the pre-commit hook compresses them.

## Commands

Always use **pnpm** (never npm or yarn). Node 24 (`.nvmrc`).

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on http://localhost:5746 ("STAG") |
| `pnpm build` | Typecheck + production build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm check` | Typecheck + Biome lint/format check + tests. **Must pass before committing.** |
| `pnpm format` | Apply Biome formatting, import sorting and safe fixes |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm devlog:video` | Compress raw videos in `devlog/` to MP4 + poster and stage them (runs as the husky pre-commit hook; needs ffmpeg) |
| `pnpm exec agent-browser` | Headless browser for devlog screenshots and checks (see `devlog/README.md`) |

## Layout

```
devlog/       per-step devlog entries + media (not shipped)
scripts/      Node dev scripts (run directly with node, e.g. devlog-video.ts)
src/
  main.tsx    entry point: WebGPU check, then the shell (or the Unsupported screen)
  shell.ts    wires sim + fixed-step loop + renderer; the only place that reads wall-clock time
  core/       loop, time, seeded RNG, math helpers
  ecs/        miniplex World<Entity>, entity/component types
  systems/    pure simulation systems: (world, dt) => void
  render/     Babylon scene setup, entity↔mesh sync, views
  input/      action bindings/presets, input state → per-tick InputFrame (dom.ts is the only DOM adapter)
  ui/         Preact HTML overlay (components, signals, CSS modules, styles/tokens.css)
  data/       data-driven definitions: abilities, augments, enemies, rooms
  debug/      dev tools (lazy, DEBUG only): commands, pane, stats/profiler, debug-draw renderer, Inspector
  demo/       throwaway test scenes, replaced by real content
```

Create a folder when a step first needs it; don't add placeholder files.

## Architecture rules

1. **Simulation is separate from rendering.** Code in `ecs/`, `systems/` and `input/` (except `input/dom.ts`), plus pure `core/` helpers, must never import `@babylonjs/*` or `preact`. That keeps it unit-testable in Node.
2. **Babylon mirrors the ECS.** `render/` creates and disposes meshes through miniplex query `onEntityAdded` / `onEntityRemoved` events, and copies state from components each frame.
3. **The UI reads signals.** The game writes `@preact/signals` at low frequency, and Preact components read them. The UI never reaches into the ECS directly. The `#ui` overlay has `pointer-events: none`, so interactive elements must opt back in.
4. **Content is data.** Abilities, augments, enemies and rooms are defined as data in `data/`, not as bespoke code paths.
5. **Fixed timestep.** The simulation advances in fixed ticks (`TICK_HZ` in `core/constants.ts`, currently 60). Systems get `dt` in seconds and must never assume a tick count. Rendering interpolates between `prevTransform` and `transform`; call `snapTransform()` after teleports/spawns.
6. **Soft determinism.** Simulation code (`ecs/`, `systems/`, pure `core/`) uses only the `dt` it's given, takes randomness only from the seeded `Rng` passed in (never `Math.random`), and never reads wall-clock time (`Date.now`, `performance.now`).
7. **Input is a per-tick snapshot.** Systems are `(world, dt, rng, input: InputFrame) => void` and read input only from that frame (actions by role: `primary`, `ability1`, …, never raw keys; world-space `move`, `moveCommand`, `aim`). A press is in `pressed` for exactly one tick. Bindings are data in `input/bindings.ts` (`mmo` and `moba` presets). Shell-level actions (pause) use `sampleFrame()` so they work while paused.
8. **Tune through tunables.** Numbers worth tweaking live in `defineTunables("group", { key: { value, min, max, step } })` (`core/tuning.ts`), which returns a live object: read it every time, never cache a value. They show up in the debug pane. Code defaults stay the source of truth: "Copy changes" in the pane gives a `group.key: old → new` snippet to paste back.
9. **Debug draw is write-only.** Any code, systems included, may call `debugDraw.line/arrow/circle/box/point/path/text` (`core/debugDraw.ts`) with a `category`. Never read from it or branch on it in the simulation. It's a no-op unless the dev tools enable it.
10. **Dev tools are gated.** `src/debug/` loads only when `DEBUG` (`pnpm dev`, or `?debug` in a production build) as a lazy chunk, so players never download it. Dev keys are commands (`debug/commands.ts`, one `define` each). In dev-keys mode (`` ` ``) no input reaches the game.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`; use the `@/` import alias for `src/`.
- Biome handles formatting and linting (no ESLint or Prettier).
- Tests cover pure logic only (systems, math, cooldowns, modifiers, RNG) and sit next to the code as `*.test.ts`, running in the Node environment. Keep Babylon out of tests; check rendering and feel by playing.
- Styling: CSS Modules (`*.module.css`) plus design tokens as CSS custom properties in `src/ui/styles/tokens.css`.
- Babylon: import from the `@babylonjs/core` root for now (deep imports may come in the 9.6 performance pass).
- Rendering is **WebGPU only** (`WebGPUEngine`); custom shaders should be WGSL. Dev-only `?nowebgpu` previews the Unsupported screen.

## Dev tools

- <kbd>`</kbd> toggles dev-keys mode; <kbd>H</kbd> then shows every dev key (pane, stats, debug draw, Inspector, wireframe, free camera, pause, time scale, …).
- The Babylon Inspector is only in `pnpm dev` builds (bundling it into production pulls ~380 KB gzipped of core into the player chunks).
- For automated checks (agent-browser `eval`), use `window.__game`: `world`, `loop`, `input`, `tunables.get/set/reset/changes`, `run("stats.cycle")`, `tools` (typed in `src/env.d.ts`). Debug settings persist in localStorage under `stag.debug`.
