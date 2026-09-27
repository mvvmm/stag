// Compresses raw videos in devlog/ into small H.264 MP4s + a JPEG poster, and stages them.
// Runs as the pre-commit hook (`pnpm devlog:video`); safe to run by hand. See devlog/README.md.

import { execFileSync } from "node:child_process";
import { readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DEVLOG = join(ROOT, "devlog");
const TAG = "devlog-compressed";
const VIDEO_EXTS = new Set([".mov", ".m4v", ".mkv", ".webm", ".avi", ".mp4"]);
const MAX_BYTES = 10 * 1024 * 1024;
const CRFS = [26, 30];

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function findVideos(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return entries
    .map((entry) => join(dir, entry))
    .filter((file) => VIDEO_EXTS.has(extname(file).toLowerCase()) && statSync(file).isFile())
    .filter((file) => !file.endsWith(".tmp.mp4"))
    .sort();
}

function isCompressed(file: string): boolean {
  if (extname(file).toLowerCase() !== ".mp4") return false;
  const comment = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format_tags=comment",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  return comment.trim() === TAG;
}

function duration(file: string): number {
  const out = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number.parseFloat(out) || 0;
}

function hasTool(name: string): boolean {
  try {
    run(name, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function encode(src: string, out: string, crf: number): void {
  run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    src,
    "-an",
    "-vf",
    "scale='min(1920,iw)':-2",
    "-fpsmax",
    "60",
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    "slow",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-metadata",
    `comment=${TAG}`,
    out,
  ]);
}

function poster(video: string, out: string): void {
  const at = Math.min(1, duration(video) / 2);
  run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-ss",
    String(at),
    "-i",
    video,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function compress(src: string): void {
  const base = src.slice(0, -extname(src).length);
  const out = `${base}.mp4`;
  const tmp = `${base}.tmp.mp4`;
  const jpg = `${base}.jpg`;
  const name = relative(ROOT, src);
  const srcBytes = statSync(src).size;

  let bytes = 0;
  for (const crf of CRFS) {
    encode(src, tmp, crf);
    bytes = statSync(tmp).size;
    if (bytes <= MAX_BYTES) break;
  }
  rmSync(src);
  renameSync(tmp, out);
  poster(out, jpg);

  run("git", ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", src]);
  run("git", ["add", "--", out, jpg]);

  console.log(
    `devlog:video ${name} (${mb(srcBytes)}) → ${relative(ROOT, out)} (${mb(bytes)}) + poster`,
  );
  if (bytes > MAX_BYTES) {
    console.warn(
      `devlog:video warning: ${relative(ROOT, out)} is over ${mb(MAX_BYTES)}; trim the clip?`,
    );
  }
}

const candidates = findVideos(DEVLOG);
if (candidates.length > 0) {
  const missing = ["ffmpeg", "ffprobe"].filter((tool) => !hasTool(tool));
  if (missing.length > 0) {
    console.error(
      `devlog:video: ${missing.join(" and ")} not found; install with \`brew install ffmpeg\`.`,
    );
    process.exit(1);
  }
  for (const file of candidates.filter((file) => !isCompressed(file))) {
    compress(file);
  }
}
