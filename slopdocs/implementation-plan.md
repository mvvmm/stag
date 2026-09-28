# Implementation Plan

> Status: **step order agreed (2026-09-27).** Each step is a one-liner on purpose. We flesh out details when we pick a step up. Design reference: [core-game-design.md](core-game-design.md).

## Guiding principles

- **Small, playable increments.** Every step should end with something runnable we can try out and tune.
- **Go deep before wide.** Prove the full run loop with **Cat** alone, then add the other forms.
- **Grey-box first, atmosphere early.** Use fog, lighting and post-processing from the start. Real models come in a dedicated art pass once the loop works.
- **Handmade before procedural.** Hand-build rooms first to learn what makes a good arena, then encode those lessons in the generator.
- **Data-driven content.** Abilities, augments, enemies and rooms are defined as data, so adding content doesn't require new systems.
- **Milestones are playtest gates.** Deploy and play at every ✅ milestone before moving on.

## Tech decisions

| Area | Decision |
|---|---|
| Engine / language | Babylon.js (**WebGPU only**, no WebGL fallback) + TypeScript (strict), Vite, pnpm |
| Movement / collision | Custom kinematic controller + simple 2D collision on the ground plane (no physics engine; Havok is optional later for props) |
| Platform | Desktop only, keyboard + mouse; current browsers with WebGPU (older browsers get an Unsupported screen) |
| UI | Hybrid: in-world UI (health bars, telegraphs, damage numbers) in Babylon; screen UI (HUD, menus, reward picks) as a light HTML overlay |
| Rooms | Hand-built in code/data first, procedural generation later |
| Art | Stylized asset packs (glTF) + our own lighting/post-processing; grey-box until the art pass |
| Hosting | Cloudflare Workers (static assets) via Workers Builds: `main` → production, PR branches → Worker Previews (public repo `mvvmm/stag`, required CI checks); R2 for large assets; D1 for server data; Astro if we need a marketing site |
| Saves | localStorage first (versioned); optional D1 cloud sync later (anonymous ID, no logins) |

---

## Phase 0: Foundation

- [x] **0.1 Project scaffold:** pnpm + Vite + TS + Babylon, lint/format, Vitest, directory layout, core deps. → [plan](plans/0.1-project-scaffold.md)
- [x] **0.2 Game shell:** canvas/engine bootstrap, resize handling, fixed-timestep simulation loop separate from rendering. → [plan](plans/0.2-game-shell.md)
- [x] **0.3 Input layer:** keyboard/mouse state, action mapping, mouse-to-ground aim point; `mmo` (WASD) and `moba` (right-click-to-move) presets. → [plan](plans/0.3-input-layer.md)
- [x] **0.3.1 Devlog:** per-step entries in `devlog/` (decisions and why + screenshots via agent-browser, optional compressed videos); backfill 0.1–0.3. → [plan](plans/0.3.1-devlog.md)
- [x] **0.4 Dev tooling:** dev-keys mode, Tweakpane tuning panel with a tunables registry, stats overlay + profiler, debug-draw helpers, Babylon Inspector, commands + `window.__game`, wireframe/free camera. → [plan](plans/0.4-dev-tooling.md)
- [x] **0.4.1 Scenes & reset:** scene registry/switcher, in-place reset, seed display + restart, frame step, entity picker. → [plan](plans/0.4.1-scenes-and-reset.md)
- [x] **0.4.2 Record & replay:** auto-recorded sessions, state checksums, save/load replay files, playback (seek, take over), headless replay tests. → [plan](plans/0.4.2-record-and-replay.md)
- [x] **0.5 Repo & Cloudflare deploy:** git repo, Workers static-asset deploy, PR preview builds. → [plan](plans/0.5-repo-and-cloudflare-deploy.md)

## Phase 1: Sandbox & Movement

- [x] **1.1 Grey-box arena:** floor, walls, pillars; angled top-down camera with tunable angle/distance. → [plan](plans/1.1-grey-box-arena.md)
- [x] **1.2 Player movement:** kinematic controller with acceleration/deceleration, facing, precise stops; prototype both WASD and right-click-to-move (moba needs basic player pathing around obstacles). → [plan](plans/1.2-player-movement.md)
- [ ] **1.3 Collision:** player vs walls/obstacles with sliding.
- [ ] **1.4 Camera follow:** smoothing, aim look-ahead, bounds.
- [ ] **1.5 Early atmosphere:** dark lighting, fog, shadows, player light, bloom/grading/vignette; readability check.
- [ ] **1.6 Placeholder character:** pack model with idle/run animations driven by movement.
- [ ] **1.7 Movement feel pass:** tune until running around the empty arena is fun on its own (gate); pick the control scheme (WASD vs right-click-to-move, or keep both as a setting).

## Phase 2: Abilities & Combat Core

- [ ] **2.1 Ability framework:** slots, cooldowns, cast states (instant/windup/channel), aiming, data-driven definitions.
- [ ] **2.2 Keybinds & dodge decision:** final ability keys; decide whether dodge is universal or form-specific.
- [ ] **2.3 First mobility ability:** Cat pounce/dash (movement override, collision, cooldown).
- [ ] **2.4 Health & damage:** health, hit shapes (circle/cone/line), damage events, death.
- [ ] **2.5 Cat basic attack + one damage ability.**
- [ ] **2.6 HUD v1:** health bar, ability bar with cooldowns (HTML overlay).
- [ ] **2.7 Combat juice:** hit flash, hitstop, screen shake, knockback, damage numbers.

## Phase 3: First Enemy (Vertical Slice)

- [ ] **3.1 Enemy framework:** enemy definitions, spawning, AI state machine.
- [ ] **3.2 Telegraph system:** ground indicators (circle/cone/line/ring), windup timing, danger visual language v1.
- [ ] **3.3 Enemy #1:** charger with a telegraphed line charge.
- [ ] **3.4 Enemy steering:** pathing around obstacles, separation between enemies.
- [ ] **3.5 Death & restart:** player death, quick reset of the arena.
- [ ] ✅ **Milestone: Vertical slice.** Cat + movement + mobility + one telegraphed enemy in a foggy arena. Deploy and playtest.

## Phase 4: Cat Kit & Loadout

- [ ] **4.1 Status effects:** root, slow, stun, DoT, stealth (needed by abilities and augments).
- [ ] **4.2 Full Cat loadout:** 3 basics + 1 ultimate playable together.
- [ ] **4.3 Cat arsenal expansion:** more than 4 basics and a second ultimate.
- [ ] **4.4 Loadout screen:** pick 3 basics + 1 ultimate before a run.

## Phase 5: Enemy Roster v1

- [ ] **5.1 Rune caster:** places zoning ground runes.
- [ ] **5.2 Shielded brute:** must be flanked or baited.
- [ ] **5.3 Third enemy role** (e.g. ranged skirmisher or summoner).
- [ ] **5.4 Encounter waves:** data-driven wave composition within a room.
- [ ] **5.5 Environmental hazards:** e.g. corruption pools, spike traps, falling debris.

## Phase 6: Run Loop Skeleton

- [ ] **6.1 Game flow:** main menu → loadout → run → results → back; pause menu.
- [ ] **6.2 Chamber abstraction:** hand-built room definitions (layout, spawns, hazards), clear detection, exit doors.
- [ ] **6.3 Run state & transitions:** room-to-room flow, persistent run state, seeded RNG.
- [ ] **6.4 Path choice:** pick the next door with a reward preview.
- [ ] **6.5 Basic rewards:** healing, run currency.
- [ ] **6.6 Augment system:** modifier pipeline into abilities; pick 1 of 3 reward UI.
- [ ] **6.7 Cat augment set v1.**
- [ ] **6.8 Handmade content:** several chambers + one open traversal stretch.
- [ ] **6.9 Mini-boss #1.**
- [ ] **6.10 Boss #1:** raid-style mechanics (phases, safe zones, beams, soaks).
- [ ] **6.11 Run end:** victory/death results and run summary.
- [ ] ✅ **Milestone: Full run with Cat.** Deploy and playtest.

## Phase 7: Meta-Progression & Grove

- [ ] **7.1 Save system:** localStorage, versioned schema, migrations.
- [ ] **7.2 Meta currencies** earned from runs.
- [ ] **7.3 Grove hub:** walkable corrupted grove; start runs from the hub.
- [ ] **7.4 Unlocks:** abilities and augments unlocked over time.
- [ ] **7.5 Grove restoration:** spend resources to visibly restore the grove and unlock upgrades.
- [ ] ✅ **Milestone: Complete roguelite loop** (run → die → progress → run again).

## Phase 8: Procedural Generation

- [ ] **8.1 Chamber generator:** rule-based obstacle/hazard/spawn placement with readability validation.
- [ ] **8.2 Run map generator:** branching paths, room-type distribution, mini-boss/boss placement.
- [ ] **8.3 Difficulty curve:** encounter budget that scales through the run.
- [ ] **8.4 Procedural open stretches:** traversal/exploration areas.
- [ ] **8.5 Seed tooling:** display and replay seeds for debugging and sharing.

## Phase 9: Art & Audio Pass (Biome 1)

- [ ] **9.1 Asset pipeline:** glTF loading, asset manifest, preloading/loading screen, R2 for large assets.
- [ ] **9.2 Biome 1 environment kit** (cursed forest), integrated with the generator.
- [ ] **9.3 Druid, Cat, and enemy models + animations.**
- [ ] **9.4 VFX language:** telegraphs, abilities, hits, deaths.
- [ ] **9.5 Audio:** SFX, ambience, music, audio system.
- [ ] **9.6 Performance pass:** profiling, instancing, shadow/draw-call budgets.
- [ ] ✅ **Milestone: Polished single-form game.**

## Phase 10: Remaining Forms

- [ ] **10.1 Form framework:** generalize per-form movement params, kits, and form selection in the hub.
- [ ] **10.2 Bear:** movement identity, arsenal, augments.
- [ ] **10.3 Moonkin:** movement identity, arsenal, augments.
- [ ] **10.4 Human:** movement identity, arsenal, augments.
- [ ] **10.5 Cross-form balance pass.**
- [ ] ✅ **Milestone: All four forms playable.**

## Phase 11: Biome 1 Content Depth

- [ ] **11.1 More enemy types and elite variants.**
- [ ] **11.2 Additional mini-bosses.**
- [ ] **11.3 Augment pool expansion** (rarity, synergies, stacking rules).
- [ ] **11.4 More grove restoration and unlock content.**

## Phase 12: Additional Biomes

- [ ] **12.1 Multi-biome run structure** (biome sequence, transitions).
- [ ] **12.2 Biome 2** (e.g. ruined kingdom): environment kit, enemies, hazards, generator rules, mini-boss, boss.
- [ ] **12.3 Biome 3** (e.g. candlelit crypts): same checklist.
- [ ] **12.4 Final boss** (fallen god / source of corruption).
- [ ] ✅ **Milestone: Full-length run.**

## Phase 13: Story Over Runs

- [ ] **13.1 Dialogue/lore system.**
- [ ] **13.2 Grove NPCs.**
- [ ] **13.3 Narrative progression** tied to deaths, victories, and restoration.

## Phase 14: Cloud & Data

- [ ] **14.1 D1 cloud save:** anonymous ID, transfer code between devices.
- [ ] **14.2 Run telemetry** (deaths, room times, picks) for balancing.

## Phase 15: Mastery Modes

- [ ] **15.1 Difficulty tiers / modifiers** (Heat-style) after the game is beaten.

## Phase 16: Release Polish

- [ ] **16.1 Settings:** keybind remapping, audio, graphics quality.
- [ ] **16.2 Onboarding/tutorial.**
- [ ] **16.3 Accessibility pass** (e.g. telegraph colors, screen shake toggle).
- [ ] **16.4 Marketing site** (Astro on Cloudflare).
