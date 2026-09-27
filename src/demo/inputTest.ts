import { Color3, MeshBuilder, StandardMaterial } from "@babylonjs/core";
import { GROUND_Y } from "@/core/constants";
import { cloneTransform, type Pawn } from "@/ecs/world";
import type { Action, InputFrame } from "@/input/actions";
import type { Shell } from "@/shell";
import { inputStats } from "@/ui/signals";

// Throwaway input test scene for step 0.3 (grown from the 0.2 loop test); replaced in 1.1/1.2.
// Loop and preset debug keys live in the dev tools (0.4).

const STATS_INTERVAL = 0.1;
/** How long a pressed action stays highlighted in the overlay, in seconds (wall clock). */
const FLASH_SECONDS = 0.3;

export function startInputTest(shell: Shell): void {
  const { world, rng, scene, input } = shell;

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

  const pawnState: Pawn = { target: null };
  const pawnTransform = { position: { x: 0, y: 0.3, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  const pawn = world.add({
    transform: pawnTransform,
    prevTransform: cloneTransform(pawnTransform),
    pawn: pawnState,
  });

  const pawnMesh = shell.meshOf(pawn);
  if (pawnMesh) {
    const pawnMaterial = new StandardMaterial("pawn", scene);
    pawnMaterial.diffuseColor = new Color3(0.85, 0.55, 0.3);
    pawnMesh.material = pawnMaterial;
  }

  // Markers read live state each frame: the aim ring follows the cursor, the pin the move target.
  const markerMaterial = (name: string, color: Color3) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color;
    return material;
  };
  const aimRing = MeshBuilder.CreateTorus("aim", { diameter: 0.8, thickness: 0.06 }, scene);
  aimRing.material = markerMaterial("aim", new Color3(0.9, 0.85, 0.6));
  const targetPin = MeshBuilder.CreateCylinder("target", { height: 1, diameter: 0.08 }, scene);
  targetPin.material = markerMaterial("target", new Color3(0.4, 0.8, 1));

  scene.onBeforeRenderObservable.add(() => {
    aimRing.position.set(input.aim.x, GROUND_Y + 0.02, input.aim.z);
    const target = pawn.pawn.target;
    targetPin.setEnabled(!!target);
    if (target) targetPin.position.set(target.x, GROUND_Y + 0.5, target.z);
  });

  // Overlay: what the simulation saw on its latest tick, plus live held actions and press counts.
  let lastTick: InputFrame | undefined;
  let dirty = true;
  let statsTimer = 0;
  const pressCounts: Partial<Record<Action, number>> = {};
  const lastPressedAt: Partial<Record<Action, number>> = {};

  shell.onTick((tick) => {
    lastTick = tick;
    const now = performance.now() / 1000;
    for (const action of tick.pressed) {
      pressCounts[action] = (pressCounts[action] ?? 0) + 1;
      lastPressedAt[action] = now;
    }
    if (tick.pressed.size || tick.released.size || tick.moveCommand) dirty = true;
  });

  let lastFrameAt = performance.now() / 1000;
  shell.onFrame((frame) => {
    if (frame.pressed.size) dirty = true;

    const now = performance.now() / 1000;
    statsTimer += now - lastFrameAt;
    lastFrameAt = now;
    if (!dirty && statsTimer < STATS_INTERVAL) return;
    statsTimer = 0;
    dirty = false;

    inputStats.value = {
      preset: input.preset.label,
      move: lastTick?.move ?? { x: 0, z: 0 },
      moveCommand: lastTick?.moveCommand ?? null,
      aim: input.aim,
      held: [...frame.held],
      pressCounts: { ...pressCounts },
      flashing: (Object.keys(lastPressedAt) as Action[]).filter(
        (action) => now - (lastPressedAt[action] ?? 0) < FLASH_SECONDS,
      ),
    };
  });
}
