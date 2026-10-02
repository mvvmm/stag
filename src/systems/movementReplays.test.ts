import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@/core/constants";
import { wrapAngle } from "@/core/math";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { createWorld } from "@/ecs/world";
import { emptyInputFrame } from "@/input/actions";
import { replayTunables, tunableValues } from "@/replay/events";
import { parseReplay } from "@/replay/format";
import { readText } from "@/replay/gzip";
import { createPlayer } from "@/replay/player";
import { restoreSnapshot } from "@/replay/snapshot";
import { sims } from "@/scenes/sims";
import { createSimulation } from "@/systems/simulation";

// Movement bugs found in playtests, replayed from their recordings (also fixtures, so their exact
// runs are pinned) and checked for the behaviour itself.

type Sample = { x: number; z: number; yaw: number; wants: boolean };

/**
 * The longest run of ticks the player moved (faster than 0.5 m/s) facing more than 90° away from
 * where it went. Turning around takes a few ticks by design (a 180° turn is 6 at 1800°/s).
 */
function longestBackwards(samples: Sample[]): number {
  let run = 0;
  let longest = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const moving = Math.hypot(dx, dz) * 60 >= 0.5;
    const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - b.yaw));
    run = moving && off > Math.PI / 2 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

async function trace(name: string): Promise<Sample[]> {
  const path = fileURLToPath(new URL(`../replay/fixtures/${name}`, import.meta.url));
  const file = parseReplay(JSON.parse(await readText(readFileSync(path))), TICK_HZ);
  const saved = tunableValues();
  tuning.apply(replayTunables(file.tunables));
  try {
    const world = createWorld();
    const rng = createRng(file.seed);
    if (file.start) restoreSnapshot(file.start, world, rng);
    else sims.get(file.scene)?.spawn(world, rng);
    const sim = sims.get(file.scene);
    if (!sim) throw new Error(`no scene ${file.scene}`);
    const simulation = createSimulation(world, rng, sim.systems);
    const player = createPlayer(file);
    const entity = world.with("player", "transform", "mover").first;
    if (!entity) throw new Error("no player");
    const samples: Sample[] = [];
    for (let tick = 0; tick < file.ticks; tick++) {
      player.takeEvents();
      simulation.step(1 / file.tickHz, player.next());
      const { position, rotation } = entity.transform;
      const { desired } = entity.mover;
      samples.push({
        x: position.x,
        z: position.z,
        yaw: rotation.y,
        wants: desired.x !== 0 || desired.z !== 0,
      });
    }
    return samples;
  } finally {
    tuning.apply(saved);
  }
}

/** The longest run of ticks the player wanted to move but didn't. */
function longestBlocked(samples: Sample[]): number {
  let run = 0;
  let longest = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    run = b.wants && Math.abs(b.x - a.x) + Math.abs(b.z - a.z) < 1e-4 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

describe("movement playtest bugs", () => {
  it("slides along a wall with WASD without the facing jittering", async () => {
    // Running diagonally into the greybox's low wall: the long body used to turn its nose into the
    // wall, get pushed off it and drift back, every three ticks.
    const samples = await trace("arena-wall-slide.replay.json.gz");
    const sliding = samples.slice(70, 135);
    const yaws = sliding.map((s) => s.yaw);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeLessThan(1e-6);
    const zs = sliding.map((s) => s.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6);
  });

  it("never stays stuck on a wall's end while following right-click paths", async () => {
    // Paths are planned for the body's width; its long nose used to catch under the end of the
    // greybox's low wall, where it could neither move on nor turn.
    const samples = await trace("arena-corner-stuck.replay.json.gz");
    expect(longestBlocked(samples)).toBeLessThan(10);
  });

  it("goes around wall ends facing forward, without stalling on the corner", async () => {
    // Right-clicking back and forth across the greybox's low wall: when the body collided as a
    // long pill, paths planned for its width hugged the wall's end, the body couldn't turn there,
    // and it walked round tail first and stalled on the corner.
    const samples = await trace("arena-around-walls.replay.json.gz");
    expect(longestBackwards(samples)).toBeLessThanOrEqual(6);
    expect(longestBlocked(samples)).toBeLessThan(10);
  });

  it("flips back and forth through where it came from when spamming A/D", () => {
    // Moving one way, then tapping left/right fast: the shortest-arc rule broke the 180° tie the
    // same way every time, so each flip carried on round and the body spun in full circles.
    const sim = sims.get("arena");
    if (!sim) throw new Error("no arena");
    const world = createWorld();
    const rng = createRng(1);
    sim.spawn(world, rng);
    const simulation = createSimulation(world, rng, sim.systems);
    const entity = world.with("player", "transform").first;
    if (!entity) throw new Error("no player");
    const input = emptyInputFrame();
    const run = (x: number, z: number, ticks: number) => {
      input.move = { x, z };
      for (let i = 0; i < ticks; i++) {
        simulation.step(1 / TICK_HZ, input);
        yaws.push(entity.transform.rotation.y);
      }
    };
    const yaws: number[] = [];
    run(0, 1, 20);
    yaws.length = 0;
    for (let flip = 0; flip < 20; flip++) run(flip % 2 === 0 ? -1 : 1, 0, 4 + (flip % 3) * 3);
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });
});
