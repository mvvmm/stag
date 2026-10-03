import { World } from "miniplex";
import type { Footprint } from "@/collision/body";
import type { Vec2 } from "@/core/math";
import type { Obstacle } from "@/data/rooms/room";

export type Vec3 = { x: number; y: number; z: number };

export type Transform = {
  position: Vec3;
  /** Euler rotation in radians. */
  rotation: Vec3;
};

/** Moves the entity in a circle around `center` on the ground plane. Throwaway demo component. */
export type Orbit = {
  center: Vec3;
  radius: number;
  /** Angular speed in radians per second. */
  speed: number;
  /** Current angle in radians. */
  angle: number;
};

/** A click-to-move order: the path the player is walking. */
export type MoveOrder = {
  /** Where the path ends (the click, or the closest reachable point to it). */
  goal: Vec2;
  /** Corners still to walk through, next first, ending with `goal`. */
  waypoints: Vec2[];
};

/** The player character's controller state (movement numbers come from `movementStats`). */
export type Player = {
  /** The click-to-move order being walked, if any; cleared on arrival, by `stop` or by WASD. */
  order: MoveOrder | null;
  /** Counts new clicks (not ticks the button is held), so the view can pop a marker per click. */
  orders: number;
  /** The last click-to-move point while the button is held, else null. */
  click: Vec2 | null;
  /** moba's attack order: walk into range of the auto attack's target (`caster.target`). */
  chase: boolean;
  /** moba's attack move (League's A, on S here), until its first attack starts or another order. */
  attackMove: AttackMove | null;
};

/**
 * An attack move: armed (S, waiting for the left click), then issued: chasing the enemy nearest the
 * click (`point` null), or walking to `point` and attacking the first enemy that comes near.
 */
export type AttackMove = {
  armed: boolean;
  point: Vec2 | null;
  /** `caster.casts` when it was armed: it's over once an attack starts. */
  casts: number;
};

/** Kinematic movement on the ground plane (the player now, enemies later). */
export type Mover = {
  /** Meters per second. */
  velocity: Vec2;
  /** The velocity a controller asks for this tick; `locomotion` accelerates toward it. */
  desired: Vec2;
  /** The sign of the facing's last turn (1 or -1), not counting reversals: a reversal turns back
   * against it, through the side the body came from. */
  turnSide: number;
};

/** Hit points. Nothing dies yet (3.1): `current` stops at 0. */
export type Health = {
  current: number;
  max: number;
  /** Damage taken this tick, one entry per hit (cleared at the start of every tick), so the view
   * can pop a number per hit. */
  taken: number[];
};

/** A training dummy: it never dies, and refills to full once it's left alone for a while. */
export type Dummy = {
  kind: "static" | "patrol";
  /** Seconds since its health last dropped. */
  sinceHit: number;
  /** Health at the end of the last tick, to notice drops however they happen. */
  lastHealth: number;
};

/** Walks back and forth between two points (a dummy's route; no AI). */
export type Patrol = {
  a: Vec2;
  b: Vec2;
  towardB: boolean;
  /** Seconds left to stand at the end it reached. */
  wait: number;
};

export type RoomInfo = { id: string; width: number; depth: number };

/** Which side a body is on: abilities hit and target the other side. */
export type Faction = "player" | "enemy";

/** The ability slots: the auto attack, three basics and the ultimate. */
export const SLOTS = ["primary", "ability1", "ability2", "ability3", "ultimate"] as const;
export type SlotId = (typeof SLOTS)[number];

/** An ability in a slot: its id in `data/abilities.ts`, and seconds left on its cooldown. */
export type AbilitySlot = { ability: string; cooldown: number };

/** Where a cast is aimed, resolved when it starts (only the fields its aim kind uses are set). */
export type CastAim = {
  /** `target` aim: the target's uid. */
  target: number | null;
  /** `point` aim: the ground point (clamped to range); `direction` aim: the cursor it aimed at. */
  point: Vec2 | null;
  /** `direction` aim: a unit vector from the caster. */
  dir: Vec2 | null;
};

/** A cast under way: its windup, then (for channelled abilities) the channel. */
export type Cast = {
  slot: SlotId;
  ability: string;
  phase: "windup" | "channel";
  /** Seconds into the current phase. */
  elapsed: number;
  aim: CastAim;
  /** Channel pulses applied so far. */
  pulses: number;
  /** The way the caster faces while casting (a unit vector), or null to face where it moves. */
  face: Vec2 | null;
};

/** A press of an ability that couldn't start yet, kept for `abilities.buffer` seconds. */
export type QueuedCast = { slot: SlotId; age: number; point: Vec2; target: number | null };

/**
 * Anything that casts abilities (the player now, enemies in 3.1). `systems/casting.ts` runs it:
 * cooldowns, cast phases, effects. Controllers (player input, later AI) only set `target` and
 * `queued`.
 */
export type Caster = {
  slots: Partial<Record<SlotId, AbilitySlot>>;
  cast: Cast | null;
  /** The auto attack's target (a uid): attacked whenever the primary slot is ready and it's in
   * range. Sticky until the controller clears it. */
  target: number | null;
  queued: QueuedCast | null;
  /** Counts casts started, so the view can play one animation per cast. */
  casts: number;
};

/** Hands out `uid`s: one per world (a singleton entity, so snapshots restore it). */
export type Ids = { next: number };

export type Entity = {
  /** A stable id for bodies other state refers to (targets, hover). miniplex's `world.id()` is
   * handed out lazily, so it can't go into sim state. */
  uid?: number;
  ids?: Ids;
  faction?: Faction;
  caster?: Caster;
  /** Abilities ignore their cooldowns (the cheat). */
  noCooldowns?: true;
  transform?: Transform;
  /** Transform at the start of the current tick; the renderer interpolates from it. */
  prevTransform?: Transform;
  orbit?: Orbit;
  player?: Player;
  mover?: Mover;
  /** Walks through obstacles (the noclip cheat). */
  noclip?: true;
  /** Blocks other movers and is blocked by them: a circle of its movement radius
   * (`movementStats(entity).radius`), so the player can't ghost through enemies. Moving or not. */
  solid?: true;
  /** A static obstacle from the room data. Has no `transform`: its footprint says where it is. */
  obstacle?: Obstacle;
  health?: Health;
  /** The body's shape for hits (separate from the movement circle), along its facing. */
  hurtbox?: Footprint;
  dummy?: Dummy;
  patrol?: Patrol;
  /** The room being played: its size, for the floor and later camera bounds. One per world. */
  room?: RoomInfo;
};

export function createWorld(): World<Entity> {
  return new World<Entity>();
}

export function cloneTransform({ position: p, rotation: r }: Transform): Transform {
  return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: r.x, y: r.y, z: r.z } };
}

export function copyTransform(from: Transform, to: Transform): void {
  to.position.x = from.position.x;
  to.position.y = from.position.y;
  to.position.z = from.position.z;
  to.rotation.x = from.rotation.x;
  to.rotation.y = from.rotation.y;
  to.rotation.z = from.rotation.z;
}

/**
 * Makes the renderer show the current transform without interpolating from the previous one.
 * Call after teleports and spawns so they don't smear across a frame.
 */
export function snapTransform(entity: Entity): void {
  if (entity.transform && entity.prevTransform) {
    copyTransform(entity.transform, entity.prevTransform);
  }
}
