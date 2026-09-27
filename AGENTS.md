# AGENTS.md

Dark-fantasy druid roguelite for the browser. Babylon.js + TypeScript (strict) + Vite.

## Docs (`slopdocs/`)

- Core game design (style & mechanics): [slopdocs/core-game-design.md](slopdocs/core-game-design.md)
- Implementation plan (step order): [slopdocs/implementation-plan.md](slopdocs/implementation-plan.md)
- Step plans: [slopdocs/plans/](slopdocs/plans/)
  - **Every implementation step gets its own plan** before any code is written, named `<step>-<slug>.md` (e.g. [`0.1-project-scaffold.md`](slopdocs/plans/0.1-project-scaffold.md)).
  - Write it by interviewing the user (one question at a time) until the plan is solid. Record decisions, defaults picked, steps and acceptance criteria.
  - Link the plan from its step in `implementation-plan.md`, and tick the step there when it's done.

## Commands

Always use **pnpm** (never npm or yarn). Node 24 (`.nvmrc`).

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck + production build to `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm check` | Typecheck + Biome lint/format check + tests. **Must pass before committing.** |
| `pnpm format` | Apply Biome formatting, import sorting and safe fixes |
| `pnpm test` / `pnpm test:watch` | Vitest |

## Layout

```
src/
  main.tsx    entry point
  core/       loop, time, seeded RNG, math helpers
  ecs/        miniplex World<Entity>, entity/component types
  systems/    pure simulation systems: (world, dt) => void
  render/     Babylon scene setup, entity↔mesh sync, views
  input/      keyboard/mouse state, action mapping
  ui/         Preact HTML overlay (components, signals, CSS modules, styles/tokens.css)
  data/       data-driven definitions: abilities, augments, enemies, rooms
  debug/      inspector, stats, tuning panel, debug draw
```

Create a folder when a step first needs it; don't add placeholder files.

## Architecture rules

1. **Simulation is separate from rendering.** Code in `ecs/` and `systems/` (and pure `core/` helpers) must never import `@babylonjs/*` or `preact`. That keeps it unit-testable in Node.
2. **Babylon mirrors the ECS.** `render/` creates and disposes meshes through miniplex query `onEntityAdded` / `onEntityRemoved` events, and copies state from components each frame.
3. **The UI reads signals.** The game writes `@preact/signals` at low frequency, and Preact components read them. The UI never reaches into the ECS directly. The `#ui` overlay has `pointer-events: none`, so interactive elements must opt back in.
4. **Content is data.** Abilities, augments, enemies and rooms are defined as data in `data/`, not as bespoke code paths.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`; use the `@/` import alias for `src/`.
- Biome handles formatting and linting (no ESLint or Prettier).
- Tests cover pure logic only (systems, math, cooldowns, modifiers, RNG) and sit next to the code as `*.test.ts`, running in the Node environment. Keep Babylon out of tests; check rendering and feel by playing.
- Styling: CSS Modules (`*.module.css`) plus design tokens as CSS custom properties in `src/ui/styles/tokens.css`.
- Babylon: import from the `@babylonjs/core` root for now (deep imports may come in the 9.6 performance pass).
