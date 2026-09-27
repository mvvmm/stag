import { TICK_HZ } from "@/core/constants";
import { parseReplay, type ReplayFile } from "@/replay/format";
import { gzip, readText } from "@/replay/gzip";

/** Reads a replay from gzipped or plain JSON bytes. Throws with a readable message. */
export async function decodeReplay(bytes: Uint8Array): Promise<ReplayFile> {
  let data: unknown;
  try {
    data = JSON.parse(await readText(bytes));
  } catch {
    throw new Error("not a replay file (unreadable JSON)");
  }
  return parseReplay(data, TICK_HZ);
}

export const encodeReplay = (file: ReplayFile): Promise<Uint8Array> => gzip(JSON.stringify(file));

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** `<scene>-<seed>-<YYYYMMDD-HHmmss>.replay.json.gz` */
export const replayFileName = (file: ReplayFile): string =>
  `${file.scene}-${file.seed}-${stamp(file.recordedAt || new Date().toISOString())}.replay.json.gz`;

/** Saves a replay as a gzipped download. */
export async function downloadReplay(file: ReplayFile): Promise<string> {
  const bytes = await encodeReplay(file);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/gzip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = replayFileName(file);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return link.download;
}

/** Opens the file picker; resolves with the chosen file's bytes, or null if cancelled. */
export function pickReplayFile(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.gz";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Calls `onDrop` with the bytes of a replay file dropped anywhere on the page. */
export function acceptDroppedReplays(onDrop: (bytes: Uint8Array) => void): void {
  const isReplay = (name: string) => /\.json(\.gz)?$|\.gz$/.test(name);
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
  const outline = (on: boolean) => {
    document.body.style.outline = on ? "2px dashed #7fa36b" : "";
    document.body.style.outlineOffset = on ? "-6px" : "";
  };
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    outline(true);
  });
  window.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) outline(false);
  });
  window.addEventListener("drop", async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    outline(false);
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => isReplay(f.name));
    if (file) onDrop(new Uint8Array(await file.arrayBuffer()));
    else console.warn("drop a .replay.json.gz or .json file to play it");
  });
}

// --- Fixtures (dev server only, see vite.config.ts) ---------------------------------------------

/** Checked-in replay names (`src/replay/fixtures/`), or [] outside `pnpm dev`. */
export async function listFixtures(): Promise<string[]> {
  if (!import.meta.env.DEV) return [];
  try {
    const response = await fetch("/__replay/list");
    return response.ok ? ((await response.json()) as string[]) : [];
  } catch {
    return [];
  }
}

export async function fetchFixture(name: string): Promise<Uint8Array> {
  const response = await fetch(`/__replay/fixture?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`no fixture "${name}"`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Writes a replay into `src/replay/fixtures/<name>.replay.json.gz` through the dev server. Asks
 * before overwriting. Resolves with the written path, or null if cancelled.
 */
export async function saveFixture(file: ReplayFile, name: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("test names are lowercase letters, digits and -");
  const body = (await encodeReplay(file)) as BodyInit;
  const post = (overwrite: boolean) =>
    fetch(`/__replay/save?name=${name}${overwrite ? "&overwrite=1" : ""}`, {
      method: "POST",
      body,
    });
  let response = await post(false);
  if (response.status === 409) {
    if (!window.confirm(`Replay test "${name}" exists. Overwrite it?`)) return null;
    response = await post(true);
  }
  if (!response.ok) throw new Error(`saving the test failed: ${await response.text()}`);
  return response.text();
}
