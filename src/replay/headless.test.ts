import { afterEach, describe, expect, it } from "vitest";
import { createRng } from "@/core/rng";
import { tuning } from "@/core/tuning";
import { inputTestSim } from "@/demo/inputTest";
import { createWorld } from "@/ecs/world";
import { type Action, emptyInputFrame, type InputFrame } from "@/input/actions";
import { quantize } from "@/input/quantize";
import { checksumWorld } from "@/replay/checksum";
import { applyEvent, tunableValues } from "@/replay/events";
import type { ReplayEventData, ReplayFile } from "@/replay/format";
import { parseReplay } from "@/replay/format";
import { gzip, readText } from "@/replay/gzip";
import { runReplay } from "@/replay/headless";
import { createPlayer } from "@/replay/player";
import { createRecorder, recorderFromReplay } from "@/replay/recorder";
import { snapshotWorld } from "@/replay/snapshot";
import type { SceneSim } from "@/scenes/sim";
import { sims } from "@/scenes/sims";
import { PAWN } from "@/systems/pawn";
import { createSimulation, type System } from "@/systems/simulation";

const HZ = 60;
const META = { commit: "test", dirty: false, recordedAt: "", tickHz: HZ };

type Step = { input?: Partial<InputFrame>; events?: ReplayEventData[] };

/** Plays a scripted session headless while recording it, like the browser does live. */
function record(
  sim: SceneSim,
  seed: number,
  ticks: number,
  script: (tick: number) => Step = () => ({}),
  cap?: number,
): ReplayFile {
  const recorder = createRecorder(
    { scene: sim.id, seed, tunables: tunableValues() },
    cap ? { cap } : {},
  );
  const world = createWorld();
  const rng = createRng(seed);
  sim.spawn(world, rng);
  const simulation = createSimulation(world, rng, sim.systems);
  for (let tick = 0; tick < ticks; tick++) {
    const { input, events = [] } = script(tick);
    for (const event of events) {
      recorder.event(event, world, rng);
      applyEvent(world, { ...event, tick } as never, () => {});
    }
    const frame = { ...emptyInputFrame(), ...input };
    simulation.step(1 / HZ, frame);
    recorder.tick(frame, world, rng);
  }
  return recorder.toFile(META, world, rng);
}

const pressed = (...actions: Action[]) => new Set<Action>(actions);

/** WASD for a second, a click-to-move, a speed change, a pane edit, a stop. */
const session = (tick: number): Step => {
  const aim = { x: quantize(Math.sin(tick / 10) * 4), z: quantize(Math.cos(tick / 13) * 3) };
  if (tick < 60) return { input: { move: { x: quantize(0.6), z: quantize(-0.8) }, aim } };
  if (tick === 70) return { input: { moveCommand: { x: 5, z: 2 }, aim } };
  if (tick === 90)
    return { input: { aim }, events: [{ kind: "tunable", id: "pawn.speed", value: 11 }] };
  if (tick === 130) {
    return {
      input: { aim },
      events: [{ kind: "edit", entity: 5, path: ["transform", "position", "x"], value: -3 }],
    };
  }
  if (tick === 150) return { input: { aim, pressed: pressed("stop"), held: pressed("stop") } };
  return { input: { aim } };
};

afterEach(() => tuning.reset());

describe("record → replay (headless)", () => {
  it("replays a scripted input-test session in sync at every checkpoint", () => {
    const file = record(inputTestSim, 1234, 200, session);
    expect(file.ticks).toBe(200);
    // Every 60 ticks, before each event tick (90, 130), and the end.
    expect(file.checksums.map((c) => c.tick)).toEqual([60, 90, 120, 130, 180, 200]);
    const result = runReplay(file, sims);
    expect(result.divergence).toBeNull();
    expect(result.checksums).toEqual(file.checksums);
  });

  it("survives saving as gzipped JSON", async () => {
    const file = record(inputTestSim, 99, 200, session);
    const text = await readText(await gzip(JSON.stringify(file)));
    expect(runReplay(parseReplay(JSON.parse(text), HZ), sims).divergence).toBeNull();
  });

  it("puts the recorded tunables in place for the run and restores the game's after", () => {
    const file = record(inputTestSim, 5, 120, session);
    tuning.set("pawn.speed", 2);
    expect(runReplay(file, sims).divergence).toBeNull();
    expect(PAWN.speed).toBe(2);
  });

  it("reports where and in what a nondeterministic system diverges", () => {
    const file = record(inputTestSim, 7, 200, session);
    let ticks = 0;
    const flaky: System = (world) => {
      if (++ticks < 100) return;
      for (const { transform } of world.with("pawn", "transform")) {
        transform.position.x += Math.random() * 1e-9;
      }
    };
    const sim = {
      ...inputTestSim,
      systems: [...inputTestSim.systems, { name: "flaky", run: flaky }],
    };
    const result = runReplay(file, { get: () => sim });
    expect(result.divergence).toEqual({ tick: 120, diff: ["transform"] });
  });

  it("rewrites checkpoints at the standard ticks for replay:update", () => {
    const file = record(inputTestSim, 3, 200, session);
    const changed = { ...file, tunables: { ...file.tunables, "pawn.speed": 3 } };
    const stale = runReplay(changed, sims);
    expect(stale.divergence?.tick).toBe(60);
    const fresh = runReplay(changed, sims, { rewrite: true });
    expect(fresh.checksums.map((c) => c.tick)).toEqual(file.checksums.map((c) => c.tick));
    expect(runReplay({ ...changed, checksums: fresh.checksums }, sims).divergence).toBeNull();
  });

  it("stops recording at the cap and still replays", () => {
    const file = record(inputTestSim, 11, 150, session, 100);
    expect(file.ticks).toBe(100);
    expect(file.checksums.at(-1)?.tick).toBe(100);
    expect(file.events.every((event) => event.tick < 100)).toBe(true);
    expect(runReplay(file, sims).divergence).toBeNull();
  });

  it("continues a replay live after a take over", () => {
    const original = record(inputTestSim, 21, 200, session);
    const takeOverAt = 100;
    // Play the replay like the browser does: player events + input, verifying checkpoints.
    tuning.apply(original.tunables);
    const world = createWorld();
    const rng = createRng(original.seed);
    inputTestSim.spawn(world, rng);
    const simulation = createSimulation(world, rng, inputTestSim.systems);
    const player = createPlayer(original);
    const fingerprints = [];
    while (player.position < takeOverAt) {
      for (const event of player.takeEvents()) applyEvent(world, event, () => {});
      simulation.step(1 / HZ, player.next());
      const expected = player.expected(player.position);
      if (expected) {
        const actual = checksumWorld(world, rng, player.position);
        expect(actual).toEqual(expected);
        fingerprints.push(actual);
      }
    }
    // Take over: the recording keeps the replay's first 100 ticks and continues live.
    const recorder = recorderFromReplay(original, takeOverAt, fingerprints);
    for (let tick = takeOverAt; tick < 160; tick++) {
      if (tick === 120) {
        const edit = { kind: "edit" as const, entity: 5, path: ["pawn", "target"], value: null };
        recorder.event(edit, world, rng);
        applyEvent(world, { ...edit, tick }, () => {});
      }
      const frame = { ...emptyInputFrame(), move: { x: 1, z: 0 } };
      simulation.step(1 / HZ, frame);
      recorder.tick(frame, world, rng);
    }
    const file = recorder.toFile(META, world, rng);
    expect(file.takenOverAt).toBe(takeOverAt);
    expect(file.ticks).toBe(160);
    expect(file.events.map((event) => event.tick)).toEqual([90, 120]);
    tuning.reset();
    expect(runReplay(file, sims).divergence).toBeNull();
  });

  it("drops events after the last tick and fails headless on commands without a runner", () => {
    const file = record(inputTestSim, 2, 30, (tick) =>
      tick === 10 ? { events: [{ kind: "command", id: "spawn.enemy" }] } : {},
    );
    expect(() => runReplay(file, sims)).toThrow('"spawn.enemy" can\'t run headless');
    const ran: string[] = [];
    expect(runReplay(file, sims, { runCommand: (id) => ran.push(id) }).divergence).toBeNull();
    expect(ran).toEqual(["spawn.enemy"]);
  });

  it("records from the middle of a run and replays from its snapshot", async () => {
    const world = createWorld();
    const rng = createRng(31);
    inputTestSim.spawn(world, rng);
    const simulation = createSimulation(world, rng, inputTestSim.systems);
    const step = (tick: number) => {
      const { input, events = [] } = session(tick);
      for (const event of events) applyEvent(world, { ...event, tick } as never, () => {});
      simulation.step(1 / HZ, { ...emptyInputFrame(), ...input });
    };
    // Play 100 ticks unrecorded, then start a recording right there.
    for (let tick = 0; tick < 100; tick++) step(tick);
    const recorder = createRecorder(
      {
        scene: inputTestSim.id,
        seed: 31,
        tunables: tunableValues(),
        start: snapshotWorld(world, rng, 100),
      },
      { world, rng },
    );
    for (let tick = 100; tick < 220; tick++) {
      const { input, events = [] } = session(tick);
      for (const event of events) {
        recorder.event(event, world, rng);
        applyEvent(world, { ...event, tick } as never, () => {});
      }
      const frame = { ...emptyInputFrame(), ...input };
      simulation.step(1 / HZ, frame);
      recorder.tick(frame, world, rng);
    }
    const file = recorder.toFile(META, world, rng);
    expect(file.ticks).toBe(120);
    expect(file.start?.tick).toBe(100);
    // Tick 0 is fingerprinted, so a restore that isn't exact shows up right away.
    expect(file.checksums[0]?.tick).toBe(0);
    // The pane edit at live tick 130 is tick 30 of the recording.
    expect(file.events.map((event) => event.tick)).toEqual([30]);

    tuning.reset();
    const text = await readText(await gzip(JSON.stringify(file)));
    const parsed = parseReplay(JSON.parse(text), HZ);
    expect(runReplay(parsed, sims).divergence).toBeNull();
    const rewritten = runReplay(parsed, sims, { rewrite: true });
    expect(rewritten.checksums).toEqual(file.checksums);
  });

  it("stops recording by hand and replays up to there", () => {
    const recorder = createRecorder({ scene: inputTestSim.id, seed: 8, tunables: tunableValues() });
    const world = createWorld();
    const rng = createRng(8);
    inputTestSim.spawn(world, rng);
    const simulation = createSimulation(world, rng, inputTestSim.systems);
    for (let tick = 0; tick < 150; tick++) {
      if (tick === 75) recorder.stop(world, rng);
      const frame = { ...emptyInputFrame(), move: { x: 1, z: 0 } };
      simulation.step(1 / HZ, frame);
      recorder.tick(frame, world, rng);
      if (tick === 100) {
        expect(recorder.event({ kind: "tunable", id: "pawn.speed", value: 2 }, world, rng)).toBe(
          false,
        );
      }
    }
    expect(recorder.stopped).toBe(true);
    const file = recorder.toFile(META, world, rng);
    expect(file.ticks).toBe(75);
    expect(file.checksums.at(-1)?.tick).toBe(75);
    expect(runReplay(file, sims).divergence).toBeNull();
  });
});
