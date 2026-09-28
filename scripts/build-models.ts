// Builds the game-ready models in public/models/ from the downloaded originals in assets-src/
// (gitignored; see CREDITS.md for where each one comes from). Run with `pnpm models:build` after
// changing this script or the source; the output is committed.
//
// tiger.glb ← assets-src/tiger/tiger-rebuilt.glb, "Tiger rebuilt" by kenchoo (CC-BY 4.0):
// https://sketchfab.com/3d-models/tiger-rebuilt-6b5d14b2de984ffcb00ee00e404ad208
// (Download 3D Model → the original .glb, saved as assets-src/tiger/tiger-rebuilt.glb.)

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Animation, type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "assets-src/tiger/tiger-rebuilt.glb");
const OUTPUT = join(ROOT, "public/models/tiger.glb");

/** The source's clip names → ours. Every clip is in place and loops already. */
const CLIPS: Record<string, string> = {
  Walk: "walk",
  "Walk Fast": "trot",
  Run: "run",
  Attack: "attack",
  Howl: "howl",
  Eat: "eat",
};

/**
 * Looping clips exported without their closing frame: the last key is the frame before the cycle
 * starts over, so wrapping straight from it to the first key skips a frame of motion (a visible
 * hitch, 26-34° on some leg bones). Closing the loop adds a key one frame later equal to the first.
 */
const CLOSE_LOOPS = ["Walk", "Walk Fast", "Run"];
/** The source's key spacing, s (24 fps). */
const FRAME = 1 / 24;

/** The idle is this clip's first pose (a calm stance), held. */
const IDLE_POSE_FROM = "Howl";
const IDLE_LENGTH = 1;

/** Longest texture side, px. The tiger is small on screen. */
const TEXTURE_SIZE = 1024;

async function main() {
  if (!existsSync(SOURCE)) {
    console.error(`missing ${SOURCE}: download the original .glb (see the header of this script)`);
    process.exit(1);
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(SOURCE);
  const root = doc.getRoot();

  for (const animation of root.listAnimations()) {
    if (CLOSE_LOOPS.includes(animation.getName())) closeLoop(doc, animation, FRAME);
  }
  for (const animation of root.listAnimations()) {
    const name = CLIPS[animation.getName()];
    if (!name) throw new Error(`unknown clip "${animation.getName()}"`);
    animation.setName(name);
  }
  const posed = root.listAnimations().find((a) => a.getName() === CLIPS[IDLE_POSE_FROM]);
  if (!posed) throw new Error(`no ${IDLE_POSE_FROM} clip`);
  addHeldPose(doc, posed, "idle", IDLE_LENGTH);

  // A zero specular (the body's) reads flat and dead under the moon; glTF's default is 0.04.
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === "KHR_materials_specular") extension.dispose();
  }

  await doc.transform(
    resample(),
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [TEXTURE_SIZE, TEXTURE_SIZE],
      quality: 88,
    }),
    quantize(),
  );

  await io.write(OUTPUT, doc);
  summarize(doc);
}

/**
 * Makes `animation` loop seamlessly: every channel gets a key `frame` seconds after the clip's end
 * with its value at the start, so the last frame blends back into the first like any other two.
 */
function closeLoop(doc: Document, animation: Animation, frame: number): void {
  const buffer = doc.getRoot().listBuffers()[0];
  const end = Math.max(...animation.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0));
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;
    const times = Array.from(input.getArray() ?? []);
    const size = output.getElementSize();
    const values = Array.from(output.getArray() ?? []);
    // Its own accessors: samplers can share an input, which must only grow once.
    sampler.setInput(
      doc
        .createAccessor(undefined, buffer)
        .setType("SCALAR")
        .setArray(new Float32Array([...times, end + frame])),
    );
    sampler.setOutput(
      doc
        .createAccessor(undefined, buffer)
        .setType(output.getType())
        .setArray(new Float32Array([...values, ...values.slice(0, size)])),
    );
  }
}

/**
 * Adds a clip `name` that holds `from`'s first pose for `length` seconds: two identical keys per
 * channel, so it loops and blends like any other clip.
 */
function addHeldPose(doc: Document, from: Animation, name: string, length: number): void {
  const buffer = doc.getRoot().listBuffers()[0];
  const clip = doc.createAnimation(name);
  const times = doc
    .createAccessor(`${name}-times`, buffer)
    .setType("SCALAR")
    .setArray(new Float32Array([0, length]));
  for (const channel of from.listChannels()) {
    const source = channel.getSampler();
    const output = source?.getOutput();
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    if (!source || !output || !node || !path) continue;
    const size = output.getElementSize();
    const first = output.getElement(0, []);
    const values = new Float32Array(size * 2);
    values.set(first, 0);
    values.set(first, size);
    const sampler = doc
      .createAnimationSampler()
      .setInput(times)
      .setOutput(doc.createAccessor(undefined, buffer).setType(output.getType()).setArray(values))
      .setInterpolation("LINEAR");
    clip.addSampler(sampler);
    clip.addChannel(
      doc.createAnimationChannel().setSampler(sampler).setTargetNode(node).setTargetPath(path),
    );
  }
}

function summarize(doc: Document): void {
  const root = doc.getRoot();
  const clips = root.listAnimations().map((animation) => {
    const end = Math.max(...animation.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0));
    return `${animation.getName()} ${end.toFixed(2)}s`;
  });
  const vertices = root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((sum, primitive) => sum + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0);
  const textures = root
    .listTextures()
    .map((t) => `${t.getName() || "texture"} ${t.getMimeType()} ${t.getSize()?.join("x")}`);
  const mb = (statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
  console.info(`${OUTPUT.slice(ROOT.length + 1)}: ${mb} MB, ${vertices} vertices`);
  console.info(`  clips: ${clips.join(", ")}`);
  console.info(`  textures: ${textures.join(", ")}`);
}

await main();
