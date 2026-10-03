import { defineTunables } from "@/core/tuning";
import type { Entity, SlotId } from "@/ecs/world";

// Abilities as data: how each one is aimed and cast, and what it does. `systems/casting.ts` runs
// them for any caster (the player now, enemies in 3.1). Numbers come from `stats(caster)`, which
// reads the ability's tunables live, so modifiers (augments) can hook in there later.

/**
 * How an ability picks where it goes:
 * - `target`: an enemy (a uid), in range edge to edge (the caster's movement circle to the
 *   target's hurtbox)
 * - `direction`: toward the cursor, from the caster
 * - `point`: the cursor's ground point, pulled in to the range
 * - `self`: on the caster
 */
export type AimKind = "target" | "direction" | "point" | "self";

/** Where an area effect lands (shapes from `combat/shapes.ts`, placed by the cast's aim). */
export type Area =
  /** A circle on the caster or on the aimed point. */
  | { kind: "circle"; radius: number; at: "caster" | "point" }
  /** A cone from the caster along the aim. */
  | { kind: "cone"; range: number; halfAngle: number }
  /** A rectangle from the caster along the aim. */
  | { kind: "line"; length: number; halfWidth: number };

export type Effect =
  /** Damage to the cast's target (`target` aim). */
  | { kind: "damage"; amount: number; area: null }
  /** Damage to every enemy body the area touches. */
  | { kind: "damage"; amount: number; area: Area };

/** An ability's numbers right now. */
export type AbilityStats = {
  /** Seconds from the start of one cast until the slot is ready again. */
  cooldown: number;
  /** Seconds before it goes off; 0 = instant. */
  windup: number;
  /** For `target` and `point` aims, m. */
  range: number;
  /** After the windup: its effects apply every `interval` seconds for `duration` seconds, instead
   * of once at the end of the windup. */
  channel: { duration: number; interval: number } | null;
  effects: Effect[];
};

export type AbilityDef = {
  id: string;
  label: string;
  aim: AimKind;
  /** The caster can't move during the windup (it faces its aim). */
  rootsWindup: boolean;
  /** The caster can't move while it channels. */
  rootsChannel: boolean;
  /** Moving cancels the channel (only for channels that don't root). */
  movingCancels: boolean;
  stats(caster: Entity): AbilityStats;
};

/** How the framework treats every ability. */
export const ABILITIES = defineTunables("abilities", {
  /** A press that can't start yet (on cooldown, or another cast running) waits this long, s. */
  buffer: { value: 0.2, min: 0, max: 1, step: 0.01 },
});

/** The Cat's auto attack. Base numbers start low, to leave room for upgrades. */
export const CAT_AA = defineTunables("catAA", {
  /** Attacks per second. */
  attackSpeed: { value: 0.7, min: 0.1, max: 5, step: 0.05 },
  /** The windup (rooted, the hit lands at its end), as a share of the time between attacks, so
   * attack speed shortens it too. */
  windupShare: { value: 0.18, min: 0, max: 0.9, step: 0.01 },
  /** Reach, edge to edge: from the cat's movement circle to the target's hurtbox, m. */
  range: { value: 1.2, min: 0, max: 10, step: 0.05 },
  damage: { value: 20, min: 0, max: 1000, step: 1 },
});

export const catAutoAttack: AbilityDef = {
  id: "cat.autoAttack",
  label: "Auto attack",
  aim: "target",
  rootsWindup: true,
  rootsChannel: false,
  movingCancels: false,
  stats() {
    const period = 1 / CAT_AA.attackSpeed;
    return {
      cooldown: period,
      windup: period * CAT_AA.windupShare,
      range: CAT_AA.range,
      channel: null,
      effects: [{ kind: "damage", amount: CAT_AA.damage, area: null }],
    };
  },
};

const registry = new Map<string, AbilityDef>([[catAutoAttack.id, catAutoAttack]]);

/** The ability with this id (tests register their own with `registerAbility`). */
export function abilityById(id: string): AbilityDef | undefined {
  return registry.get(id);
}

/** Adds (or replaces) an ability definition. */
export function registerAbility(def: AbilityDef): void {
  registry.set(def.id, def);
}

/** The Cat's slots until the loadout screen: only the auto attack so far (2.4/2.5 add more). */
export const CAT_SLOTS: Partial<Record<SlotId, string>> = { primary: catAutoAttack.id };
