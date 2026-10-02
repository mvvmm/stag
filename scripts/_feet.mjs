import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read("public/models/tiger.glb");
const root = doc.getRoot();
const clip = process.argv[2] ?? "run";
const anim = root.listAnimations().find((a) => a.getName() === clip);
// sample a channel at time t (linear / slerp-ish nlerp)
const sample = (ch, t) => {
  const s = ch.getSampler();
  const inp = s.getInput().getArray();
  const out = s.getOutput().getArray();
  const n = s.getOutput().getElementSize();
  let i = 0;
  while (i < inp.length - 2 && inp[i + 1] <= t) i++;
  const t0 = inp[i],
    t1 = inp[Math.min(i + 1, inp.length - 1)];
  const a = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 0;
  const v = [];
  let dot = 0;
  for (let j = 0; j < n; j++) dot += out[i * n + j] * out[Math.min(i + 1, inp.length - 1) * n + j];
  const sign = n === 4 && dot < 0 ? -1 : 1;
  for (let j = 0; j < n; j++)
    v.push(out[i * n + j] * (1 - a) + sign * out[Math.min(i + 1, inp.length - 1) * n + j] * a);
  if (n === 4) {
    const l = Math.hypot(...v);
    for (let j = 0; j < 4; j++) v[j] /= l;
  }
  return v;
};
const channels = new Map();
for (const c of anim.listChannels()) {
  const node = c.getTargetNode();
  if (!channels.has(node)) channels.set(node, {});
  channels.get(node)[c.getTargetPath()] = c;
}
const mat = (t, r, s) => {
  const [x, y, z, w] = r;
  const xx = x * x,
    yy = y * y,
    zz = z * z,
    xy = x * y,
    xz = x * z,
    yz = y * z,
    wx = w * x,
    wy = w * y,
    wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0],
    2 * (xy + wz) * s[0],
    2 * (xz - wy) * s[0],
    0,
    2 * (xy - wz) * s[1],
    (1 - 2 * (xx + zz)) * s[1],
    2 * (yz + wx) * s[1],
    0,
    2 * (xz + wy) * s[2],
    2 * (yz - wx) * s[2],
    (1 - 2 * (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
};
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const sceneRoots = root.listScenes()[0].listChildren();
const world = (t) => {
  const out = new Map();
  const walk = (node, parent) => {
    const ch = channels.get(node) ?? {};
    const T = ch.translation ? sample(ch.translation, t) : node.getTranslation();
    const R = ch.rotation ? sample(ch.rotation, t) : node.getRotation();
    const S = ch.scale ? sample(ch.scale, t) : node.getScale();
    const m = mul(parent, mat(T, R, S));
    out.set(node.getName().replace(/_\d+_\d+$/, ""), m);
    for (const c of node.listChildren()) walk(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const n of sceneRoots) walk(n, I);
  return out;
};
const inp = anim.listChannels()[0].getSampler().getInput().getArray();
const dur = inp[inp.length - 1];
const feet = {
  LH: "Bip01 L Toe0",
  RH: "Bip01 R Toe0",
  LF: "Bip01 L Finger0",
  RF: "Bip01 R Finger0",
  pelvis: "Bip01 Pelvis",
  spine: "Bip01 Spine",
};
const N = 48;
const rows = [];
for (let k = 0; k < N; k++) {
  const t = (k / N) * dur;
  const w = world(t);
  const r = { k };
  for (const [key, name] of Object.entries(feet)) {
    const m = w.get(name);
    if (!m) {
      r[key] = null;
      continue;
    }
    r[key] = [m[12], m[13], m[14]];
  }
  rows.push(r);
}
console.log(clip, "duration", dur.toFixed(3));
console.log(
  "k  " +
    Object.keys(feet)
      .map((f) => f.padStart(16))
      .join(""),
);
for (const r of rows)
  console.log(
    String(r.k).padStart(2) +
      " " +
      Object.keys(feet)
        .map((f) =>
          r[f]
            ? `${r[f][0].toFixed(0)},${r[f][1].toFixed(0)},${r[f][2].toFixed(0)}`.padStart(16)
            : "-".padStart(16),
        )
        .join(""),
  );
