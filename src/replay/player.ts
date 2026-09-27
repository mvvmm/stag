import type { InputFrame } from "@/input/actions";
import type { Checkpoint } from "@/replay/checksum";
import { createInputDecoder, type ReplayEvent, type ReplayFile } from "@/replay/format";

export type Player = ReturnType<typeof createPlayer>;

/**
 * Walks a replay forward one tick at a time: the events due before the next tick, that tick's
 * input, and the checkpoint expected once a number of ticks have run. `rewind()` starts over
 * (seeking back reloads the scene and plays forward again).
 */
export function createPlayer(file: ReplayFile) {
  const expected = new Map(file.checksums.map((checkpoint) => [checkpoint.tick, checkpoint]));
  let decoder = createInputDecoder(file.input, file.actions);
  let eventIndex = 0;

  return {
    file,
    /** Ticks played so far (the next tick's index). */
    get position(): number {
      return decoder.tick;
    },
    get done(): boolean {
      return decoder.tick >= file.ticks;
    },
    rewind(): void {
      decoder = createInputDecoder(file.input, file.actions);
      eventIndex = 0;
    },
    /** Events to apply before the next tick runs (each is returned once). */
    takeEvents(): ReplayEvent[] {
      const due: ReplayEvent[] = [];
      for (let event = file.events[eventIndex]; event; event = file.events[eventIndex]) {
        if (event.tick > decoder.tick) break;
        if (event.tick === decoder.tick) due.push(event);
        eventIndex++;
      }
      return due;
    },
    /** The next tick's input. */
    next(): InputFrame {
      if (decoder.tick >= file.ticks) throw new Error("replay has no more ticks");
      return decoder.next();
    },
    /** The checkpoint recorded after `tick` ticks, if there is one. */
    expected(tick: number): Checkpoint | undefined {
      return expected.get(tick);
    },
  };
}
