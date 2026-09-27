# 0.5 Repo & Cloudflare Deploy

> 2026-09-27 · [plan](../../slopdocs/plans/0.5-repo-and-cloudflare-deploy.md) · [PR #1](https://github.com/mvvmm/stag/pull/1)

![The game's Worker Preview for the 0.5 branch with `?debug`: the input test running at 60 fps, and the pane titled "Debug · 1aa441e", the commit the Preview was built from](01-preview-debug.png)

## What we built

The game left the laptop. It lives in a public GitHub repo, [mvvmm/stag](https://github.com/mvvmm/stag), and is served from Cloudflare at [stag.root-mvm.workers.dev](https://stag.root-mvm.workers.dev) as a static-assets-only Worker. From now on every step is a branch and a pull request:

- Four GitHub Actions jobs must pass before anything can merge: `typecheck`, `lint` (Biome lint + format), `test` (with the replay fixtures) and `build`.
- Cloudflare Workers Builds builds every push as a **Worker Preview** and comments its URL on the PR: a stable URL that follows the branch, plus one per commit.
- Merging to `main` deploys production.

The debug pane now shows the commit it was built from, so a bug report from a playtest can say which build it came from. Deployed builds send the same cross-origin isolation headers as dev and stay out of search engines. Workers Logs and tracing are switched on for when the Worker gets code of its own.

## Key decisions

- **Public, because of required checks.** The plan started private. GitHub Free only enforces branch rules on public repos, and we wanted merges blocked on red checks, so the repo went public. That made a secret audit the first job: gitleaks over all 24 commits, a grep for keys and home paths, and a look through every screenshot and video frame. It came up clean.
- **"All rights reserved", with third-party assets kept separate.** We talked through whether AI-written code can carry that notice. It can, but it mostly means "no permission granted", since how far copyright reaches into AI output is unsettled. The bigger risk is future asset packs: many allow shipping in a game but not redistributing the files, and a public repo counts as redistributing. So `CREDITS.md` now tracks every asset's license, and non-redistributable ones will never be committed.
- **Workers Builds deploys, Actions only checks.** Cloudflare's own Git integration handles production and Previews with no Cloudflare secret in GitHub. Worker Previews had shipped five days earlier.
- **A deploy token that can only touch this Worker.** Per-Worker permissions (also brand new) let an account-owned token edit `stag` and nothing else. That token now replaces `wrangler login` for local and agent deploys. Workers Builds can't use one yet (it only takes user tokens), so it keeps its own build token for now.
- **Four named checks instead of one.** The first version ran everything as a single `check` job. We split it so a red PR says *what* broke.
- **Merge commits, one branch per step.** Step commits and the devlog's commit links survive the merge, and `git log --first-parent main` reads as one line per step.

## Surprises & problems

- **Two brand-new Cloudflare features met in the middle.** Per-Worker token scoping and Worker Previews both landed in the two weeks before this step. They don't fully fit together yet: the scoped token works for wrangler, but Builds can't use it, and it can't even register itself as a build token (403).
- **A per-Worker token can't target a Worker that doesn't exist.** The very first deploy had to run with a full login, and only then could the scoped token be created.
- **`wrangler preview` refuses to run without a `previews` block** in the config, even an empty one. That's why the first Preview build failed.
- **Tokens stayed a dashboard job.** The Cloudflare API connection could set up the whole Workers Builds configuration (repo, commands, previews), but isn't allowed near API tokens. The user created the tokens by hand.
- The workers.dev subdomain came from the account (`root-mvm`), not the GitHub handle, so the README link we'd guessed was wrong until the first deploy.

## Media

![PR #1: the Cloudflare bot's comment with the stable Preview URL for the branch and a table of per-commit deployments (two successful, one failed build from the missing `previews` block), above the commit list with its check marks](02-pr-preview-and-checks.png)
