# 1.6 Placeholder Character

> 2026-09-28 · [plan](../../slopdocs/plans/1.6-placeholder-character.md)

![A full-size tiger galloping across the greybox at night, in its own warm light between the pillars](01-hero.png)

## What we built

The grey-box capsule became a tiger, standing in for the Cat form until the art pass. It stands and breathes when still, then walks, trots and gallops as the player speeds up. Four clips are blended by speed on one shared stride, so the footfalls line up. On top of the clips, procedural layers bank the body into turns, tilt it when speeding up and braking, swing the tail and turn the head toward the cursor. It's all view-only and runs on the time the view shows, so pause, frame step, time scale and replays show the same motion, and every replay fixture passed untouched. A small build script turns the downloaded model into a 1.8 MB game-ready file, and the shell preloads it once. After the first playtest the tiger went to full size, the player got a pill-shaped hitbox to match its long body, and the top speed dropped from 7 to 4 m/s. A "placeholder body" switch in the pane shows the hitbox as a grey-box pill, next to the new `footprint` debug outline.

## Key decisions

- **No low-poly, even for a placeholder.** We started from CC0 low-poly packs and dropped them: they aren't the direction of the game. Mid- and high-poly CC-BY models from Sketchfab were the fastest source we could commit.
- **Check the animations before committing to a model.** We picked a black panther for its looks. Reading its one 16.5 s clip frame by frame, and tracking each foot through the skeleton, showed each foot stepping only once or twice: an idle, a few shuffling steps, a crouch and a step back. There was no gait to loop, so we switched to a tiger with real walk, trot and gallop cycles.
- **Sample the clips ourselves.** Babylon's animation groups advance on wall-clock time. Evaluating the clips by hand on `viewTime()` (the sim time the view shows, new on the scene context) freezes on pause, steps with a frame step and follows replay seeks, and made a shared stride phase across gaits easy.
- **Built offline, committed as output.** `pnpm models:build` renames the clips, adds a held idle pose, drops a zero specular that made the fur look dead, converts the textures to WebP and quantizes the geometry: 12 MB became 1.8 MB. The original stays out of the repo and is credited in CREDITS.md.
- **Scale to the footprint, then the footprint to the body.** We first drew the tiger at half size over the old 0.4 m circle to keep the simulation untouched. The playtest wanted it twice as big, and a 2 m cat can't be a circle, so the footprint became data: a radius (half the width) and a length. At most twice the radius it's a circle, so the human and the other forms can bring their own. Collision treats the pill as a row of overlapping circles along the spine, so the swept-circle code from 1.3 carries over unchanged.
- **A long body has to fit its turns.** Turning swings the nose and tail, so locomotion only turns as far as the body fits: an end that swings into a wall pushes the body aside, and between two walls it turns halfway or not at all. Pathing still plans for the width.

## Surprises & problems

- **Every bone name had a suffix** (`Bip01 Spine1_03_11`), so the first build threw on the first frame and the render loop stopped silently on a black screen. Rendering one frame by hand from the console surfaced the error.
- **The tiger was too dark, then too bright.** The capsule had been kept out of the player's warm light (it blew out its head). The tiger is low enough to take it, but its back then faced the light head-on. Lighting it and halving the direct light on its fur (`tiger.light`) keeps it orange with readable stripes.
- **The body sat off its footprint.** At half size we shifted the model back 17 cm to center it. Measured at full size, the body's center is only 5 cm behind the origin, so that shift was what made it trail its circle.
- **The random walk caught a push-out bug.** Walking and turning a pill through both rooms for 20,000 ticks found the body ending inside a wall on the first run. The push-out only looked at obstacles near where the body started, so pushing clear of one could shove it into a wall it hadn't considered. It now looks again on every pass. The four replay fixtures were rerecorded for the new footprint and speed.
- **A readability note for later:** the tiger's orange sits close to the red-orange of the stand-in danger telegraphs. That's something to settle in 3.2 and with the real Cat model.
- **The glTF loader split the bundle** into many small lazy chunks. The first load grew by about 0.1 MB gzipped, plus the model.

- **Two playtest bugs, caught on recordings.** Sliding along a wall with WASD, the long body turned its nose into the wall, got pushed off it and drifted back every three ticks: the facing now follows where the body actually went, and a moving body only turns as far as it fits. On right-click paths it got stuck at the end of a wall, once because a push-out left it exactly touching (rounding did the rest) and once because its nose caught under the wall where it could neither move nor turn: push-outs leave a skin now, and a blocked body may push itself clear to turn toward where it wants to go. Both recordings became regression tests that check the behaviour, not just the numbers.
- **More League.** A second round of playtest notes made turning near instant (1800°/s), added `M` to switch control schemes, and gave the right-click scheme League's camera: the cursor locked in the window, the camera panning at the screen edges, Space to center it.

## Media

The four gaits up close, at full size: idle, walk, trot and gallop.

![Idle, walk, trot and gallop](02-gaits.png)

The head follows the cursor, here to the right and then to the left.

![The head turned right, then left](03-head-look.png)

With the stand-in threats, in color and in the value view: the tiger stays the brightest, warmest thing in the room.

![The tiger next to the stand-in telegraphs, in color and in greyscale](04-value-view.png)

The pill footprint under the tiger and the grey-box body the "placeholder body" switch shows instead. The tiger looks shifted up the screen only because its body is up to a meter off the ground; its hind feet are in the pill's back cap.

![The tiger and the grey-box pill over the same footprint](05-footprint.png)

Why the panther didn't make it: one clip, and frame by frame it's an idle, a few shuffling steps, a crouch and a step back.

![The panther's clip over 16 seconds](06-panther-clip.png)

The tiger's clips from the side, as we checked them before building on it: the idle pose, walk, trot, gallop and the unused howl, eat and attack.

![The tiger's clips from the side](07-tiger-clips.png)
