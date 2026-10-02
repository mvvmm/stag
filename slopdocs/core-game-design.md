# Core Game Design: Style & Mechanics

> Status: **direction agreed, details open.** This captures the high-level design decisions from the initial design interview (2026-09-27). Fine-grained numbers, ability lists, and content are intentionally not decided yet.

## 1. Pitch

A **dark-fantasy roguelite** built in **Babylon.js** for the browser. You play a lone **druid** fighting through a corrupted wild in short, replayable runs. Before each run you commit to one **shapeshift form**, choose a loadout of abilities from that form's arsenal, and during the run those abilities mutate into a build unique to that attempt.

Small in scope, deep in replayability: we get longevity from a tight core loop that plays differently each run, not from a huge amount of content.

## 2. Design Pillars

1. **Gratifying, controlled movement.** Movement is **a** core mechanic (alongside combat and exploration), not *the* single main mechanic. It must feel fluid, intuitive, and precise on its own, and be enhanced by abilities on cooldown.
2. **Readable positioning problems, not bullet spam.** Threats are deliberate, telegraphed, and few enough to reason about. The player solves them with positioning and cooldown timing. Constant bullet-hell barrages are explicitly out.
3. **Mastery & flow.** The player should visibly get better over time. Skill expression comes from movement, positioning, ability timing, and build choices.
4. **Serious, immersive atmosphere.** Dark and atmospheric. Can be stylized, but it takes itself seriously. No goofy or cartoony tone.
5. **Small scope, long retention.** Prefer systems that multiply replay value (loadouts × augments × forms) over hand-authored content volume.

## 3. Inspirations (and what we take from each)

| Game | What we take |
|---|---|
| **World of Warcraft** | Fluid WASD movement; tiny micro-adjustments feel good; mobility abilities (jumps, sprints, teleports); druid shapeshifting fantasy; raid mechanics as positioning puzzles. |
| **League of Legends** | Constant positioning problems (dodging skillshots, engaging, disengaging); fine-grained movement control; dashes and speed boosts on cooldown; Q/W/E/R ability layout. |
| **Hades** | Room-by-room roguelite structure; mid-run rewards that modify your abilities; hub + meta-progression; story unfolding across runs. |

**Anti-inspiration:** bullet-hell / "dodge the screen full of projectiles" design.

## 4. Camera & Controls

- **Camera:** angled top-down / isometric-style 3D view (Hades / V Rising-like). Chosen for threat readability (telegraphs, enemies, and terrain visible at once) and for achievable visual quality.
- **Movement:** two schemes, both kept as a player setting (decided at the 1.7 movement feel gate). **WASD is the default**; every ability and enemy has to work with both.
  - **MMO preset:** **WASD** direct control of the character (WoW-style "I'm steering my body" feel). Abilities on `1`/`2`/`3` + `4` (ultimate), right mouse = basic attack, left mouse = interact.
  - **MOBA preset:** League-style **right-click to move** (hold to steer; right-click on an enemy attacks), abilities on `Q`/`W`/`E` + `R` (ultimate), left mouse = interact, `S` = stop. League's camera too: the cursor is locked inside the window, the camera is free and pans at the screen edges, and `Space` centers it on the character (held: follows). Dodge is provisionally `F` here.
  - The pause menu (`Esc`) picks the scheme, and `M` switches anytime. The setting moves into the 6.1 pause menu and the 16.1 settings.
- **Aiming:** mouse aims abilities (cursor projected onto the ground) in both schemes.
- **Abilities:** 3 basics + 1 ultimate; keys per preset above. Bindings are data, and remapping comes in 16.1.

> Open: final keybinds (2.3); whether dodge (provisionally `Space`) is universal or form-specific; controller support.

### Movement feel requirements

- Responsive: minimal input latency, fast acceleration/deceleration, precise stops.
- Micro-adjustments are easy and satisfying (small repositioning to step out of a telegraph edge).
- Turns are near instant, like League, and the body sells them: it bends and has slack instead of spinning like a pole (1.7). A reversal swings back through the side you came from. The Cat's own model (9.3) should have a shorter body than the placeholder tiger, closer to Nidalee's cougar.
- Base movement should be fun **with nothing else happening**. If running around an empty arena isn't enjoyable, tune it before building anything else.
- Mobility abilities (dash, pounce, blink, leap, charge, sprint) are the **cooldown-gated enhancement** layer: tools to escape, engage, or reposition, with meaningful decisions about when to spend them.

## 5. The Druid & Forms

The player character is a **single druid**. The "classes" are the druid's shapeshift forms. **You pick one form before each run.**

| Form | Role | Movement identity (initial idea) |
|---|---|---|
| 🐻 **Bear** | Tank / bruiser | Heavy, committal: charges, ground slams, unstoppable movement |
| 🐈 **Cat** | Melee assassin | Agile and aggressive: pounces, stealth repositions, fast dashes |
| 🌙 **Moonkin** | Ranged magic caster | Spacing and control: blinks, zoning, repositioning to keep range |
| 🏹 **Human** | Hybrid ranged/melee (bow & blade) | Flexible: rolls, leaps, switching between range and melee |

Each form should have a **distinct movement identity**, so picking a form changes how you move, not just how you deal damage.

> Open: whether mid-run form swapping ever happens (current decision: one form per run).

### Ability loadout

- Each form has an **arsenal of more than 4 abilities**.
- Before a run, the player picks **4 to bring**:
  - **3 basic abilities** (`Q`/`W`/`E` slots): interchangeable; any basic can go in any slot.
  - **1 ultimate** (`R` slot), chosen from that form's ultimates.
- Loadout choice is a core strategic layer (closer to League/WoW talent loadouts than to Hades, where abilities come from mid-run boons).

## 6. Run Structure

Run-based roguelite: short runs, death ends the run, some progress carries over.

### Layout

- **Combat chambers:** clear a room → pick a reward → choose the next path. Tight arenas designed with hazards and terrain to create controlled positioning problems.
- **Open stretches:** occasional traversal/exploration areas between chambers (movement challenges, secrets, breathing room) that let mobility shine outside combat.
- **Mini-boss rooms** and **boss rooms** as run peaks.

### Encounters

- **Standard rooms:** a **few dangerous foes** (roughly 3–6), each with a distinct role and **readable, telegraphed** attacks (e.g. a charger, a caster placing ground runes, a shielded brute), combined with environmental hazards.
- **Mini-bosses:** a step up; one strong enemy (possibly with support) with multi-part mechanics.
- **Bosses:** WoW-raid-style positioning puzzles: safe zones, beams, soaks, phases.
- Rule of thumb: **every threat should be a question the player answers with positioning or cooldown timing.** If a threat can only be survived by luck or twitch-dodging spam, it's wrong for this game.

### Mid-run rewards: Ability augments

- Rewards **modify the 4 abilities you brought** rather than adding new ones.
  - e.g. "Pounce now roots the target," "Your dash leaves a trail of thorns," "Starfall strikes twice."
- The loadout stays fixed, but it **mutates into a unique build** each run.
- This keeps each form's identity sharp while making runs feel different.

## 7. Meta-Progression (between runs)

**In scope now:**
- **Unlocks:** expand each form's ability arsenal and the augment pool over time, giving more loadout options and build variety.
- **Grove hub:** a corrupted druid grove you gradually **restore** between runs. It serves as visible progress and home base, unlocking upgrades (and later NPCs/lore). Starts dark and blighted, slowly comes back to life.

**Implement later** (agreed, deprioritized to focus on core gameplay):
- **Story revealed over runs:** lore and the druid's story unfold across deaths and victories (Hades-style).
- **Difficulty tiers / mastery modes:** escalating optional modifiers after beating the game (like Hades' Heat) for long-term mastery.

## 8. Setting & Tone

- **Dark fantasy:** ruined kingdoms, cursed forests, candlelit crypts, fallen gods, a spreading corruption.
- Natural fit for druidic magic, shapeshifting, and the "restore the grove" arc.
- Tone is serious and immersive. Cute or stylized is acceptable; silly or cartoony (Fortnite / Fall Guys style) is not.

## 9. Art Direction

- **Painterly dark stylized:** moderate-poly models, hand-painted-style textures, and atmosphere driven by **lighting, fog, shadow, and color grading** rather than polygon count.
- Reference mood: Darksiders, V Rising, Diablo IV's atmosphere at lower fidelity.
- Telegraphs and threats must stay **highly readable** against a dark scene (strong silhouettes, clear VFX language for danger zones).
- Must perform well in the browser.

## 10. Priorities & First Milestone

Focus is on **core gameplay mechanics first**; content, story, and polish come later.

**Suggested first vertical slice (grey-box is fine):**
1. One form (**Cat** is a good candidate, since it's the most movement-centric) in one foggy, well-lit arena.
2. Nail the **base movement feel** and **one mobility ability**.
3. Add **one telegraphed enemy** that forces repositioning.

If that loop is fun with placeholder art, the rest of the game builds on it. If it isn't, we learn that cheaply.

## 11. Open Questions (not yet decided)

- Control scheme (WASD vs right-click-to-move, decided at 1.7), exact keybinds, controller support; whether dodge is universal or form-specific.
- Full ability arsenals per form; which abilities are basics vs ultimates.
- Augment system details (rarity, stacking, synergies).
- Run length, number of biomes/chambers, boss count.
- Resources/currencies for meta-progression and grove restoration.
- Health/healing model, death and run-reward economy.
- Enemy roster and telegraph visual language.
- Tech stack beyond Babylon.js (bundler, physics, asset pipeline, hosting).
