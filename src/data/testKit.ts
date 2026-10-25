import { defineTunables } from "@/core/tuning";
import { type AbilityDef, registerAbility } from "@/data/abilities";
import type { SlotId } from "@/ecs/world";

// The test kit (2.3): four grey-box abilities to try the cast modes, the indicator and walking
// into range on the dummies. Dev-only: the `cheats.testKit` sim command puts them in the player's
// empty slots, and no player build's loadout has them. All four root during the windup and face
// their aim.

export const TEST_KIT = defineTunables("testKit", {
  lineLength: { value: 8, min: 0.5, max: 20, step: 0.1 },
  lineWidth: { value: 1, min: 0.1, max: 5, step: 0.05 },
  lineWindup: { value: 0.25, min: 0, max: 2, step: 0.01 },
  lineCooldown: { value: 4, min: 0, max: 30, step: 0.1 },
  lineDamage: { value: 60, min: 0, max: 1000, step: 1 },
  burstRange: { value: 7, min: 0, max: 20, step: 0.1 },
  burstRadius: { value: 2, min: 0.1, max: 10, step: 0.05 },
  burstWindup: { value: 0.4, min: 0, max: 2, step: 0.01 },
  burstCooldown: { value: 6, min: 0, max: 30, step: 0.1 },
  burstDamage: { value: 80, min: 0, max: 1000, step: 1 },
  coneRange: { value: 3.5, min: 0.5, max: 15, step: 0.1 },
  /** Either side of the aim, degrees. */
  coneHalfAngle: { value: 45, min: 1, max: 180, step: 1 },
  coneWindup: { value: 0.15, min: 0, max: 2, step: 0.01 },
  coneCooldown: { value: 3, min: 0, max: 30, step: 0.1 },
  coneDamage: { value: 40, min: 0, max: 1000, step: 1 },
  /** Edge to edge, like the auto attack's. */
  strikeRange: { value: 6, min: 0, max: 20, step: 0.1 },
  strikeWindup: { value: 0.5, min: 0, max: 2, step: 0.01 },
  strikeCooldown: { value: 10, min: 0, max: 60, step: 0.1 },
  strikeDamage: { value: 150, min: 0, max: 1000, step: 1 },
});

const base = {
  rootsWindup: true,
  rootsChannel: false,
  movingCancels: false,
  interruptible: false,
} as const;

/** Q: a rectangle along the aim. */
export const testLine: AbilityDef = {
  ...base,
  id: "test.line",
  label: "Test line",
  aim: "direction",
  stats: () => ({
    cooldown: TEST_KIT.lineCooldown,
    windup: TEST_KIT.lineWindup,
    range: TEST_KIT.lineLength,
    channel: null,
    effects: [
      {
        kind: "damage",
        amount: TEST_KIT.lineDamage,
        area: { kind: "line", length: TEST_KIT.lineLength, halfWidth: TEST_KIT.lineWidth / 2 },
      },
    ],
  }),
};

/** W: a circle at the aimed point; self cast drops it at the caster's feet. */
export const testBurst: AbilityDef = {
  ...base,
  id: "test.burst",
  label: "Test burst",
  aim: "point",
  selfCast: true,
  stats: () => ({
    cooldown: TEST_KIT.burstCooldown,
    windup: TEST_KIT.burstWindup,
    range: TEST_KIT.burstRange,
    channel: null,
    effects: [
      {
        kind: "damage",
        amount: TEST_KIT.burstDamage,
        area: { kind: "circle", radius: TEST_KIT.burstRadius, at: "point" },
      },
    ],
  }),
};

/** E: a cone from the caster along the aim. */
export const testCone: AbilityDef = {
  ...base,
  id: "test.cone",
  label: "Test cone",
  aim: "direction",
  stats: () => ({
    cooldown: TEST_KIT.coneCooldown,
    windup: TEST_KIT.coneWindup,
    range: TEST_KIT.coneRange,
    channel: null,
    effects: [
      {
        kind: "damage",
        amount: TEST_KIT.coneDamage,
        area: {
          kind: "cone",
          range: TEST_KIT.coneRange,
          halfAngle: (TEST_KIT.coneHalfAngle * Math.PI) / 180,
        },
      },
    ],
  }),
};

/** R: a single-target strike, so a target out of range has something to walk into range for. */
export const testStrike: AbilityDef = {
  ...base,
  id: "test.strike",
  label: "Test strike",
  aim: "target",
  stats: () => ({
    cooldown: TEST_KIT.strikeCooldown,
    windup: TEST_KIT.strikeWindup,
    range: TEST_KIT.strikeRange,
    channel: null,
    effects: [{ kind: "damage", amount: TEST_KIT.strikeDamage, area: null }],
  }),
};

for (const def of [testLine, testBurst, testCone, testStrike]) registerAbility(def);

/** Where the `cheats.testKit` command puts them (D/F stay empty). */
export const TEST_KIT_SLOTS: Partial<Record<SlotId, string>> = {
  ability1: testLine.id,
  ability2: testBurst.id,
  ability3: testCone.id,
  ultimate: testStrike.id,
};
