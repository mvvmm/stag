# Devlog

A record of how the game gets built, one entry per implementation step: what we built, the decisions we made and why, and what it looked like at the time. It's written for looking back later (and as raw material for blog posts), not for players.

Each step's detailed plan lives in [`slopdocs/plans/`](../slopdocs/plans/). The devlog is the short story version with pictures.

## Entries

| Step | Title | Date |
|---|---|---|
| 0.0 | [Finding the game](0.0-concept/index.md) | 2026-09-27 |
| 0.1 | [Project scaffold](0.1-project-scaffold/index.md) | 2026-09-27 |
| 0.2 | [Game shell](0.2-game-shell/index.md) | 2026-09-27 |
| 0.3 | [Input layer](0.3-input-layer/index.md) | 2026-09-27 |
| 0.3.1 | [Devlog](0.3.1-devlog/index.md) | 2026-09-27 |
| 0.4 | [Dev tooling](0.4-dev-tooling/index.md) | 2026-09-27 |
| 0.4.1 | [Scenes & reset](0.4.1-scenes-and-reset/index.md) | 2026-09-27 |
| 0.4.2 | [Record & replay](0.4.2-record-and-replay/index.md) | 2026-09-27 |
| 0.5 | [Repo & Cloudflare deploy](0.5-repo-and-cloudflare-deploy/index.md) | 2026-09-27 |
| 1.1 | [Grey-box arena](1.1-grey-box-arena/index.md) | 2026-09-27 |
| 1.2 | [Player movement](1.2-player-movement/index.md) | 2026-09-27 |
| 1.3 | [Collision](1.3-collision/index.md) | 2026-09-27 |
| 1.4 | [Camera follow](1.4-camera-follow/index.md) | 2026-09-27 |
| 1.5 | [Early atmosphere](1.5-early-atmosphere/index.md) | 2026-09-28 |
| 1.6 | [Placeholder character](1.6-placeholder-character/index.md) | 2026-09-28 |
| 1.6.1 | [cf CLI](1.6.1-cf-cli/index.md) | 2026-09-29 |
| 1.7 | [Movement feel pass](1.7-movement-feel/index.md) | 2026-10-02 |
| 1.7.1 | [Unsupported devices](1.7.1-unsupported-devices/index.md) | 2026-10-02 |
| 2.1 | [Health, damage & test dummies](2.1-health-and-dummies/index.md) | 2026-10-02 |
| 2.2 | [Ability framework + Cat auto attack](2.2-ability-framework/index.md) | 2026-10-02 |

## Layout

```
devlog/
  <step>-<slug>/        slug matches the step's plan file
    index.md            the entry
    01-overview.png     screenshots, NN-what-it-shows.png, in reading order
    some-clip.mp4       videos (compressed by the pre-commit hook)
    some-clip.jpg       poster frame for the video
```

## Entry template

```md
# 0.3 Input Layer

> 2026-09-27 · [plan](../../slopdocs/plans/0.3-input-layer.md) · commit `0e329e1`

![What the hero shot shows](01-overview.png)

## What we built
2–4 sentences: what exists now that didn't before, and what you can do with it.

## Key decisions
- **Decision.** Why, and what we rejected. (3–6 bullets, the ones worth remembering)

## Surprises & problems
- What bit us and how we fixed it.

## Media
More screenshots with one-line captions. Videos as a poster linking to the clip:
[![Clip caption](some-clip.jpg)](some-clip.mp4)
```

Keep entries to about 300–600 words. Write in "we", in the past tense. Dates are the step commit's date. The sources are the step plan, the commits and the Claude Code sessions for that step. Summarize the sessions; never paste transcript text, emails or local paths.

## Screenshots (agent)

The agent takes screenshots with [agent-browser](https://agent-browser.dev) (a devDependency) at the end of each step. The number of shots scales with the step: 1–4 for engine and system steps, and many for art, atmosphere and VFX steps (before/after pairs, several angles and lighting setups, close-ups).

1. `pnpm build && pnpm preview --port 5747 --strictPort` (in the background; 5746 stays free for `pnpm dev`).
2. Open the game at 1920×1080. Headless Chromium has working WebGPU on macOS, so no extra flags are needed:
   ```sh
   ab() { ./node_modules/.bin/agent-browser --session devlog "$@"; }
   ab set viewport 1920 1080
   ab open http://localhost:5747 && ab wait 2000
   ```
3. Set up the state worth showing:
   - `ab mouse move x y`, `ab mouse down right` / `ab mouse up right`, `ab press b`
   - held keys: agent-browser has no key-down command, so use `ab eval 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW"}))'` (and a matching `keyup`)
4. Capture with `ab screenshot devlog/<entry>/NN-slug.png`.
   - **A phone (touch, no mouse):** `ab set device "iPhone 16 Pro"` only changes the viewport, and headless Chromium keeps a fine pointer. Launch Chrome for Testing (under `~/.agent-browser/browsers/`) yourself with `--headless=new --remote-debugging-port=9333 --user-data-dir=<scratchpad>/touch "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"` and drive it with `agent-browser --cdp 9333` (`--args` splits that flag on its commas).
5. **Look at every image** before using it. Throw away black frames, the Unsupported screen and half-loaded scenes.
6. When you're done, run `ab close` and stop the preview server.

**Old commits** (backfill or re-shoots):

- `git worktree add <scratchpad>/wt-<step> <sha>`, then `pnpm install --frozen-lockfile` in it.
- Run `pnpm exec vite --port 5748 --strictPort` there. Dev mode also allows `?unsupported=device|webgpu|error` (`?nowebgpu` before 1.7.1).
- Take the shots, then `git worktree remove --force <path>`.

The per-step commits so far:

| Step | Commit |
|---|---|
| 0.1 | `b18be46` |
| 0.2 | `2303ca7` |
| 0.3 | `0e329e1` |
| 0.4 | `b045d34` (revised in `18b4b93`, `25fd320`) |
| 0.4.1 | `5fc8a1a` (revised in `e66306b`, `a55974a`, `fcf5527`) |
| 0.4.2 | `e72397a` |
| 0.5 | [PR #1](https://github.com/mvvmm/stag/pull/1) (merge commit on `main`) |

## Videos (you)

1. Open the game in Firefox (or any browser) and go fullscreen with **Cmd+Ctrl+F**, so only the game is on screen.
2. Record with **QuickTime** (File → New Screen Recording, or Cmd+Shift+5). Keep clips short (10–60 s) and show one thing per clip.
3. Save the `.mov` into the entry folder with a descriptive name (`moba-steering.mov`).
4. Commit as usual. The husky pre-commit hook runs `pnpm devlog:video`, which:
   - turns every uncompressed video under `devlog/` into `<name>.mp4`: H.264 at most 1920 wide and 60 fps, no audio, ~10 MB target, tagged `comment=devlog-compressed`
   - adds a `<name>.jpg` poster
   - deletes the raw file and stages both results
5. Link it from the entry: `[![Caption](moba-steering.jpg)](moba-steering.mp4)`.

You can run `pnpm devlog:video` by hand to preview the result before committing. Raw formats (`.mov`, `.m4v`, `.mkv`, `.webm`, `.avi`) are gitignored under `devlog/`, so they can't be committed by accident. It needs `ffmpeg` (`brew install ffmpeg`).
