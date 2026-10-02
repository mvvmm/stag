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
