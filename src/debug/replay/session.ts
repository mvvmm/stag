import { TICK_HZ } from "@/core/constants";
import { type TunableValue, tuning } from "@/core/tuning";
import type { CommandRegistry } from "@/debug/commands";
import { type Checkpoint, checksumWorld, diffCheckpoints } from "@/replay/checksum";
import { applyEdit, applyEvent, type Edit, replayTunables, tunableValues } from "@/replay/events";
import type { ReplayFile } from "@/replay/format";
import type { Divergence } from "@/replay/headless";
import { createPlayer, type Player } from "@/replay/player";
import { createRecorder, type Recorder, recorderFromReplay } from "@/replay/recorder";
import { scenes } from "@/scenes";
import type { Shell, TickDriver } from "@/shell";
import { replayStatus } from "@/ui/signals";

/** Most time a seek spends fast-forwarding per frame, so the page stays responsive. */
const SEEK_BUDGET_MS = 12;
const BADGE_INTERVAL_MS = 100;

type Playback = {
  file: ReplayFile;
  player: Player;
  /** Checkpoints taken this pass (from tick 0), used to continue the recording on take over. */
  actual: Checkpoint[];
  /** The first mismatch found (kept across seeks, so the pane can offer to jump back). */
  divergence: Divergence | null;
  /** A mismatch was found since the last reload (only the first one per pass pauses). */
  divergedThisPass: boolean;
  /** Last checkpoint that matched before the first divergence. */
  lastGood: number;
};

type Seek = { target: number; resume: boolean; done: (() => void)[] };

export type ReplayMode = "idle" | "recording" | "full" | "playing" | "ended";

export type ReplaySession = ReturnType<typeof createReplaySession>;

/**
 * Record & replay in the browser (dev tools only). Every load starts a fresh recording; a replay
 * plays through the in-place reset with the tick driver; seeking reloads and fast-forwards;
 * taking over continues the recording live from the current tick. While a replay's tunables are
 * in place, the player's own are kept aside (and stored instead) and come back on the next load.
 */
export function createReplaySession(
  shell: Shell,
  options: {
    commands: CommandRegistry;
    setPaused(paused: boolean): void;
    /** Something the pane shows changed. */
    changed(): void;
  },
) {
  const { commands, setPaused, changed } = options;

  let recorder: Recorder | null = null;
  let playback: Playback | null = null;
  /** The player's tunables, set aside while a replay's are in place. */
  let userTunables: Record<string, TunableValue> | null = null;
  /** The next load is the session's own (play or seek back) for this replay. */
  let ownLoad: ReplayFile | null = null;
  let seek: Seek | null = null;
  /** Set while the session itself changes tunables or runs commands, so they aren't recorded. */
  let applying = false;
  let notice = "";

  const setNotice = (text: string, level: "info" | "warn" = "info") => {
    notice = text;
    if (text) console[level](`replay: ${text}`);
    changed();
  };

  const quietly = (run: () => void) => {
    applying = true;
    try {
      run();
    } finally {
      applying = false;
    }
  };

  const meta = () => ({
    commit: __COMMIT__,
    dirty: __DIRTY__,
    recordedAt: new Date().toISOString(),
    tickHz: TICK_HZ,
  });

  // --- Playback --------------------------------------------------------------------------------

  const driver: TickDriver = {
    input(tick) {
      const player = playback?.player;
      if (!player) throw new Error("replay driver without a replay");
      if (tick !== player.position) {
        console.error(`replay: loop tick ${tick} ≠ replay tick ${player.position}`);
      }
      for (const event of player.takeEvents()) {
        quietly(() => applyEvent(shell.world, event, (id) => commands.replay(id)));
      }
      return player.next();
    },
    canTick: () => !!playback && !playback.player.done,
  };

  const finishSeek = () => {
    const finished = seek;
    seek = null;
    if (!finished) return;
    if (finished.resume && playback && !playback.player.done && !playback.divergedThisPass) {
      setPaused(false);
    }
    for (const done of finished.done) done();
    changed();
  };

  /** After each played tick: check the checkpoint, stop at the end. */
  const verify = (pb: Playback) => {
    const tick = pb.player.position;
    const expected = pb.player.expected(tick);
    if (expected) {
      const actual = checksumWorld(shell.world, shell.rng, tick);
      pb.actual.push(actual);
      const diff = diffCheckpoints(expected, actual);
      if (diff.length && !pb.divergedThisPass) {
        pb.divergedThisPass = true;
        if (!pb.divergence || tick < pb.divergence.tick) pb.divergence = { tick, diff };
        console.warn(`replay diverged at tick ${tick}: ${diff.join(", ")}`);
        setPaused(true);
        finishSeek();
      } else if (!diff.length && !pb.divergedThisPass && !pb.divergence) {
        pb.lastGood = tick;
      }
    }
    if (pb.player.done) {
      setPaused(true);
      finishSeek();
    }
  };

  // --- Loads -----------------------------------------------------------------------------------

  shell.onBeforeLoad(({ def, seed }) => {
    if (ownLoad && playback) {
      const file = ownLoad;
      ownLoad = null;
      if (!userTunables) userTunables = tunableValues();
      const values = replayTunables(file.tunables);
      const unknown = Object.keys(file.tunables).filter((id) => tuning.get(id) === undefined);
      quietly(() => tuning.apply(values));
      if (unknown.length) setNotice(`tunables not in this build: ${unknown.join(", ")}`, "warn");
      playback.player.rewind();
      playback.actual = [];
      playback.divergedThisPass = false;
      recorder = null;
      shell.setTickDriver(driver);
      return;
    }
    // Anything else (scene switch, restart, exit): back to live, with the player's tunables.
    ownLoad = null;
    if (playback) {
      playback = null;
      shell.setTickDriver(null);
      finishSeek();
    }
    if (userTunables) {
      const restored = userTunables;
      userTunables = null;
      quietly(() => tuning.apply(restored));
    }
    recorder = createRecorder({ scene: def.id, seed, tunables: tunableValues() });
    changed();
  });

  shell.onTick((frame) => {
    if (playback) {
      verify(playback);
      return;
    }
    if (!recorder || recorder.full) return;
    recorder.tick(frame, shell.world, shell.rng);
    if (recorder.full) setNotice("recording full (60 min): saving still works", "warn");
  });

  // Seeks fast-forward in slices, before the frame's own ticks (which stay paused meanwhile).
  let badgeAt = 0;
  shell.onFrame(() => {
    if (seek && playback) {
      const pb = playback;
      const start = performance.now();
      while (
        seek &&
        pb.player.position < seek.target &&
        !pb.player.done &&
        performance.now() - start < SEEK_BUDGET_MS
      ) {
        shell.loop.step();
      }
      if (seek && pb.player.position >= seek.target) finishSeek();
    }
    const now = performance.now();
    if (now - badgeAt >= BADGE_INTERVAL_MS) {
      badgeAt = now;
      publishBadge();
    }
  });

  const publishBadge = () => {
    const pb = playback;
    if (!pb) {
      if (replayStatus.value) replayStatus.value = null;
      return;
    }
    const next = {
      tick: pb.player.position,
      ticks: pb.file.ticks,
      tickHz: pb.file.tickHz,
      diverged: pb.divergence?.tick ?? null,
      seeking: seek ? Math.floor((pb.player.position / Math.max(seek.target, 1)) * 100) : null,
    };
    const last = replayStatus.value;
    const same =
      last &&
      last.tick === next.tick &&
      last.ticks === next.ticks &&
      last.diverged === next.diverged &&
      last.seeking === next.seeking;
    if (!same) replayStatus.value = next;
  };

  // --- Out-of-band sim changes -----------------------------------------------------------------

  const session = {
    /** Plays a replay from tick 0 (through a scene load). Throws if its scene doesn't exist. */
    play(file: ReplayFile): void {
      const def = scenes.get(file.scene);
      if (!def) throw new Error(`replay scene "${file.scene}" doesn't exist in this build`);
      setNotice(
        file.commit !== __COMMIT__
          ? `recorded on ${file.commit}, build is ${__COMMIT__}: may diverge`
          : file.dirty
            ? `recorded with local changes on ${file.commit}: may diverge`
            : "",
      );
      finishSeek();
      playback = {
        file,
        player: createPlayer(file),
        actual: [],
        divergence: null,
        divergedThisPass: false,
        lastGood: 0,
      };
      ownLoad = file;
      shell.load(def, file.seed);
      setPaused(false);
      changed();
    },

    /** Goes to a tick of the playing replay (reloading first when it's behind). */
    seek(target: number): Promise<void> {
      const pb = playback;
      if (!pb) return Promise.resolve();
      const tick = Math.max(0, Math.min(Math.round(target), pb.file.ticks));
      const resume = seek ? seek.resume : !shell.loop.paused;
      const done = seek?.done ?? [];
      setPaused(true);
      if (tick < pb.player.position) {
        const def = scenes.get(pb.file.scene);
        if (!def) return Promise.resolve();
        ownLoad = pb.file;
        shell.load(def, pb.file.seed);
      }
      seek = { target: tick, resume, done };
      changed();
      return new Promise((resolve) => done.push(resolve));
    },

    /** One tick back (a reload and fast-forward). */
    stepBack(): Promise<void> {
      return playback ? session.seek(playback.player.position - 1) : Promise.resolve();
    },

    /** Back to the last checkpoint that matched before the divergence. */
    jumpToLastGood(): Promise<void> {
      return playback ? session.seek(playback.lastGood) : Promise.resolve();
    },

    /** Live input takes over at the current tick; the recording continues from the replay's. */
    takeOver(): void {
      const pb = playback;
      if (!pb) return;
      const tick = pb.player.position;
      recorder = recorderFromReplay(pb.file, tick, pb.actual);
      playback = null;
      finishSeek();
      shell.setTickDriver(null);
      shell.input.resetEdges();
      publishBadge();
      setNotice(`took over at tick ${tick}; your tunables come back on the next load`);
    },

    /** Leaves playback: restarts the scene live and running, with the player's tunables back. */
    exit(): void {
      if (!playback) return;
      shell.restart();
      setPaused(false);
      publishBadge();
      setNotice("");
    },

    /** An entity-pane edit: takes over first during playback, and is recorded. */
    edit(edit: Edit): void {
      if (playback) session.takeOver();
      recorder?.event({ kind: "edit", ...edit }, shell.world, shell.rng);
      applyEdit(shell.world, edit);
    },

    /** The current recording as a file, or the replay being played. */
    currentFile(): ReplayFile | null {
      if (playback) return playback.file;
      return recorder ? recorder.toFile(meta(), shell.world, shell.rng) : null;
    },

    /** Tunable overrides to store instead of the live ones while a replay's are in place. */
    storedOverrides(): Record<string, TunableValue> | null {
      if (!userTunables) return null;
      const defaults = new Map(tuning.list().map((tunable) => [tunable.id, tunable.default]));
      return Object.fromEntries(
        Object.entries(userTunables).filter(
          ([id, value]) => defaults.has(id) && defaults.get(id) !== value,
        ),
      );
    },

    get mode(): ReplayMode {
      if (playback) return playback.player.done ? "ended" : "playing";
      if (!recorder) return "idle";
      return recorder.full ? "full" : "recording";
    },
    get notice(): string {
      return notice;
    },
    setNotice,
    /** The playing replay's file (null when live). */
    get file(): ReplayFile | null {
      return playback?.file ?? null;
    },
    /** Ticks played or recorded. */
    get tick(): number {
      return playback ? playback.player.position : (recorder?.ticks ?? 0);
    },
    get ticks(): number {
      return playback ? playback.file.ticks : (recorder?.ticks ?? 0);
    },
    get divergence(): Divergence | null {
      return playback?.divergence ?? null;
    },
    get seeking(): boolean {
      return seek !== null;
    },
  };

  // Tunable changes are sim input: recorded live. During playback they're the player's own
  // tweaks on top of the replay (which may make it diverge), kept for when they get theirs back.
  tuning.onChange((id) => {
    if (applying || id === null) return;
    const value = tuning.get(id);
    if (value === undefined) return;
    if (userTunables) userTunables[id] = value;
    if (!playback) recorder?.event({ kind: "tunable", id, value }, shell.world, shell.rng);
  });

  // Sim commands are recorded; during playback running one takes over first.
  commands.onBeforeRun((command) => {
    if (!command.sim) return;
    if (playback) session.takeOver();
    recorder?.event({ kind: "command", id: command.id }, shell.world, shell.rng);
  });

  return session;
}
