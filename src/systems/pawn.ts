import type { World } from "miniplex";
import type { Rng } from "@/core/rng";
import type { Entity } from "@/ecs/world";
import type { InputFrame } from "@/input/actions";

/**
 * Throwaway demo movement for the input test scene: constant speed, no acceleration or collision.
 * WASD moves directly; otherwise the pawn walks to its click-to-move target. Faces the aim point.
 */
export function pawnSystem(world: World<Entity>, dt: number, _rng: Rng, input: InputFrame): void {
  for (const { transform, pawn } of world.with("transform", "pawn")) {
    const position = transform.position;
    if (input.pressed.has("stop")) pawn.target = null;
    if (input.moveCommand) pawn.target = { x: input.moveCommand.x, z: input.moveCommand.z };

    const step = pawn.speed * dt;
    if (input.move.x !== 0 || input.move.z !== 0) {
      pawn.target = null;
      position.x += input.move.x * step;
      position.z += input.move.z * step;
    } else if (pawn.target) {
      const dx = pawn.target.x - position.x;
      const dz = pawn.target.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= step) {
        position.x = pawn.target.x;
        position.z = pawn.target.z;
        pawn.target = null;
      } else {
        position.x += (dx / distance) * step;
        position.z += (dz / distance) * step;
      }
    }

    const ax = input.aim.x - position.x;
    const az = input.aim.z - position.z;
    if (Math.hypot(ax, az) > 1e-3) transform.rotation.y = Math.atan2(ax, az);
  }
}
