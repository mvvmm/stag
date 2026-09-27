import { cloneTransform } from "@/ecs/world";
import type { Shell } from "@/shell";

// Throwaway loop test scene for step 0.2; replaced by the grey-box arena in 1.1.
// Raw key handling is temporary too: the real input layer comes in 0.3.

const TIME_SCALES = [1, 0.25, 0.05];

export function startLoopTest({ world, rng, loop, settings, publishStats }: Shell): void {
  // One fast box makes 60 Hz judder obvious on a high-refresh display when interpolation is off.
  const orbits = [
    { radius: 7, speed: 3 },
    ...Array.from({ length: 4 }, () => ({
      radius: rng.range(1.5, 6),
      speed: rng.range(0.6, 2.5) * rng.pick([-1, 1]),
    })),
  ];

  const center = { x: 0, y: 0.3, z: 0 };
  for (const { radius, speed } of orbits) {
    const angle = rng.range(0, Math.PI * 2);
    const transform = {
      position: {
        x: center.x + Math.cos(angle) * radius,
        y: center.y,
        z: center.z + Math.sin(angle) * radius,
      },
      rotation: { x: 0, y: -angle, z: 0 },
    };
    world.add({
      transform,
      prevTransform: cloneTransform(transform),
      orbit: { center, radius, speed, angle },
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    switch (event.code) {
      case "KeyI":
        settings.interpolate = !settings.interpolate;
        break;
      case "KeyP":
        loop.paused = !loop.paused;
        break;
      case "KeyT": {
        const next = (TIME_SCALES.indexOf(loop.timeScale) + 1) % TIME_SCALES.length;
        loop.timeScale = TIME_SCALES[next] ?? 1;
        break;
      }
      default:
        return;
    }
    publishStats();
  });
}
