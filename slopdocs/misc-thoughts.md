# Misc Thoughts

> Loose ideas jotted down as they come up. Nothing here is decided; promote an idea into [core-game-design.md](core-game-design.md) once we commit to it.

## Stag form: the true druid form (2026-09-27)

- Stag form was the user's favourite druid form in WoW, so we want it to matter.
- Idea: the **stag is a core lore point**, perhaps the druid's lost or original "true" form.
- It could be unlocked as a **final true druid form in the endgame**, e.g. after restoring the grove or defeating the source of the corruption.
- Open questions: is it playable as a fifth form or only a finale? Does it tie into the grove restoration arc or the story over runs? What's its movement identity (graceful leaps, a sprint/charge, a travel form for the open stretches)?
- Small nod already in place: the dev server runs on port **5746 = "STAG"**.

## Idle animations for the Cat (2026-10-02)

- After about 10 s standing still, the cat does an idle at random times: sitting on its rump, rolling onto its side to scratch behind an ear with a hind leg, rolling on the ground to scratch its back, maybe chasing its tail.
- Each one should be triggerable from the dev pane, and moving should interrupt it at once.
- Parked: the placeholder tiger has no sit, scratch, roll or tail-chase clips (only unused howl, eat and attack). Faking them procedurally on its rig would likely look as uncanny as the stepping stop we reverted in 1.7. They belong with the Cat's own model and hand-made clips (9.3). The tail chase might work procedurally (circling on the spot, head after the tail).

## A better stop animation for the Cat (2026-10-02)

- The tiger's stop still looks fake: it rotates back into its standing pose. When it stops, the gait strides on briefly, then every bone cross-fades into the standing pose at once, so the feet slide into place without stepping.
- Tried in 1.7 and reverted as "extremely uncanny": stopping leg by leg. Planted feet held, the other legs landed, then each stepped into the stance one at a time with its foot lifted (commit `5cb4545`, reverted in `389d809`).
- The sim stops dead in about 0.05 s, so the view has to sell the stop. Ideas for later:
  - a hand-made stop clip on the Cat's own model (9.3): a braking stride into a stand, likely the real fix
  - foot planting with IK, so the feet stay put while the body settles
  - a short braking slide or skid, if it suits the cat's character
