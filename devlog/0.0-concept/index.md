# 0.0 Finding the Game

> 2026-09-27 · [core game design](../../slopdocs/core-game-design.md) · [implementation plan](../../slopdocs/implementation-plan.md)

No code yet, and nothing to screenshot. This entry covers the two design sessions that came before step 0.1: one to find the game, one to plan how to build it.

## What we built

Two documents. [`core-game-design.md`](../../slopdocs/core-game-design.md) describes a **dark-fantasy druid roguelite**: a lone druid fights through a corrupted wild in short runs, picking one shapeshift form per run. [`implementation-plan.md`](../../slopdocs/implementation-plan.md) breaks building it into ~90 one-line steps across 16 phases, each to be fleshed out only when we pick it up.

## Key decisions

- **Small scope, deep loop.** The brief was "not an MMO, but something that holds attention for a long time." A replayable run-based loop gets there without piling on content, so we picked a **run-based roguelite** (Hades as the reference).
- **Serious, not cartoony.** Dark and atmospheric, *painterly dark stylized* rather than low-poly or semi-realistic. Nothing Fortnite or Fall Guys.
- **Movement is a core mechanic (one of several).** The inspiration is how movement feels in WoW and League: precise micro-adjustments, plus mobility abilities on cooldown (dash, leap, blink). Threats are **few, readable and telegraphed**, and each one is a positioning problem. Bullet hell is explicitly out.
  - First draft: "movement is *the* main skill." That was corrected to "*a* core mechanic, alongside combat and exploration."
- **One druid, four forms.** Bear (tank), Cat (melee assassin), Moonkin (ranged caster) and a Human bow form. Each has more than four abilities. Before a run you bring 3 basics + 1 ultimate, and during the run you earn **ability augments**.
- **Between runs:** unlocks and restoring the grove hub now; story over runs and difficulty tiers later. The focus stays on core gameplay first.
- **Space:** chambers plus open stretches. Typical rooms have a few dangerous foes, with mini-boss and boss rooms on top.
- **Build plan:**
  - Vite + TS + Babylon with custom movement (no physics engine)
  - desktop only
  - go **deep before wide**: a full run with Cat alone before the other forms
  - hand-built rooms before procedural generation
  - atmosphere early, real models late
  - Cloudflare for the whole stack
  - localStorage saves first, D1 later
  - the plan runs all the way to the full multi-biome vision

## Surprises & problems

- **Free-text "Other" answers were lost** when an option was also selected in the question tool, and they couldn't be recovered from the transcript. The fix was a convention: long thoughts go in "Other" alone, or in plain chat. That lost answer (the WoW/League movement story) ended up being the most important input of the session.

## Media

None. The first pixels are in [0.1](../0.1-project-scaffold/index.md).
