import { describe, expect, it } from "vitest";
import { ACTIONS, type Action, emptyInputFrame, type InputFrame } from "@/input/actions";
import { QUANT, quantize } from "@/input/quantize";
import {
  createInputDecoder,
  createInputEncoder,
  FORMAT,
  parseReplay,
  type ReplayFile,
  VERSION,
} from "@/replay/format";

const frame = (overrides: Partial<InputFrame> = {}): InputFrame => ({
  ...emptyInputFrame(),
  ...overrides,
});
const set = (...actions: Action[]) => new Set<Action>(actions);

const script: InputFrame[] = [
  frame(),
  frame({ move: { x: quantize(Math.SQRT1_2), z: quantize(-Math.SQRT1_2) }, held: set("primary") }),
  frame({ move: { x: quantize(Math.SQRT1_2), z: quantize(-Math.SQRT1_2) }, held: set("primary") }),
  frame({ pressed: set("dodge"), held: set("dodge"), aim: { x: 3.5, z: -1.25 } }),
  frame({ moveCommand: { x: 2, z: 4 }, aim: { x: 2, z: 4 } }),
  frame({ moveCommand: { x: 2, z: 4 }, aim: { x: 2, z: 4 } }),
  frame({ released: set("dodge"), aim: { x: 2, z: 4 } }),
  frame({ hover: 3, held: set("primary") }),
  frame({ hover: 3, held: set("primary") }),
  frame({ hover: 0 }),
  frame(),
];

describe("input encoding", () => {
  it("round-trips every tick exactly", () => {
    const encoder = createInputEncoder();
    for (const tick of script) encoder.push(tick);
    expect(encoder.ticks).toBe(script.length);

    const decoder = createInputDecoder(encoder.data, ACTIONS);
    for (const expected of script) expect(decoder.next()).toEqual(expected);
    expect(decoder.tick).toBe(script.length);
  });

  it("writes nothing for idle or repeated ticks", () => {
    const encoder = createInputEncoder();
    for (let i = 0; i < 1000; i++) encoder.push(frame());
    expect(encoder.data).toEqual([]);
    const held = frame({ held: set("primary"), aim: { x: 1, z: 1 } });
    for (let i = 0; i < 1000; i++) encoder.push(held);
    // One record: tick delta, mask, aim x/z, held.
    expect(encoder.data).toHaveLength(5);
    const decoder = createInputDecoder(encoder.data, ACTIONS);
    for (let i = 0; i < 1000; i++) decoder.next();
    expect(decoder.next()).toEqual(held);
    expect(decoder.next()).toEqual(held);
  });

  it("stores positions as integer quant units", () => {
    const encoder = createInputEncoder();
    encoder.push(frame({ aim: { x: 1.5, z: -2 } }));
    expect(encoder.data).toEqual([0, 8, 1.5 * QUANT, -2 * QUANT]);
  });

  it("maps actions by name, dropping ones this build doesn't know", () => {
    const encoder = createInputEncoder();
    encoder.push(frame({ held: set("primary", "dodge") }));
    const renamed = ACTIONS.map((action) => (action === "dodge" ? "roll" : action));
    const reordered = [...ACTIONS].reverse();
    // Reading with another file order reinterprets the bits by name.
    const bits = encoder.data[2] as number;
    const decoder = createInputDecoder([0, 16, bits], renamed);
    expect([...decoder.next().held]).toEqual(["primary"]);
    const reversedDecoder = createInputDecoder(encoder.data, reordered);
    const held = reversedDecoder.next().held;
    expect(held.size).toBe(2);
    expect(held.has("primary")).toBe(false);
  });
});

describe("parseReplay", () => {
  const valid = (): ReplayFile => ({
    format: FORMAT,
    v: VERSION,
    commit: "abc1234",
    dirty: false,
    recordedAt: "2026-09-27T12:00:00.000Z",
    scene: "input-test",
    seed: 42,
    tickHz: 60,
    actions: [...ACTIONS],
    quant: QUANT,
    ticks: 0,
    tunables: {},
    input: [],
    events: [],
    checksums: [{ tick: 0, entities: 0, rng: 1, components: {} }],
  });

  it("accepts a valid file", () => {
    expect(parseReplay(JSON.parse(JSON.stringify(valid())), 60)).toEqual(valid());
  });

  it("rejects other files, versions and tick rates with a readable message", () => {
    expect(() => parseReplay({ hello: 1 }, 60)).toThrow("not a replay file");
    expect(() => parseReplay({ ...valid(), v: 2 }, 60)).toThrow("version 2");
    expect(() => parseReplay(valid(), 30)).toThrow("60 Hz, this build at 30 Hz");
    expect(() => parseReplay({ ...valid(), seed: -1 }, 60)).toThrow('"seed"');
    expect(() => parseReplay({ ...valid(), input: [0.5] }, 60)).toThrow('"input"');
  });
});
