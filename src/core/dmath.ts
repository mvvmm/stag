/**
 * Deterministic math for the simulation. JavaScript only guarantees `+ - * /` and `Math.sqrt` to
 * be exact; `Math.sin`, `cos`, `atan2`, `hypot`, `pow`, `exp`, … may differ in the last bit
 * between engines and versions (Chrome and Node really do disagree on `atan2`). A last-bit
 * difference grows, and a replay recorded in one browser diverges in another or in the headless
 * tests. These are built from exact operations only, so every engine gets the same bits.
 *
 * Ports of FreeBSD msun (fdlibm) kernels, accurate to about 1 ulp (constants written as the
 * shortest literal of the same double). Range reduction for sin/cos
 * is the three-step Cody-Waite one, accurate for |x| < ~1e6; beyond that results lose precision
 * but stay deterministic. Simulation code uses these instead of `Math.*` (a test enforces it).
 */

// --- sin / cos ----------------------------------------------------------------------------------

const S1 = -0.16666666666666632;
const S2 = 0.00833333333332249;
const S3 = -0.0001984126982985795;
const S4 = 2.7557313707070068e-6;
const S5 = -2.5050760253406863e-8;
const S6 = 1.58969099521155e-10;

/** sin(x + y) for |x + y| ≤ π/4, y the tail of x. */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 0.0416666666666666;
const C2 = -0.001388888888887411;
const C3 = 2.480158728947673e-5;
const C4 = -2.7557314351390663e-7;
const C5 = 2.087572321298175e-9;
const C6 = -1.1359647557788195e-11;

/** cos(x + y) for |x + y| ≤ π/4, y the tail of x. */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

const INV_PIO2 = 0.6366197723675814;
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_2T = 2.0222662487959506e-21;
const PIO2_3 = 2.0222662487111665e-21;
const PIO2_3T = 8.4784276603689e-32;

// Scratch for range reduction: x = n·π/2 + (hi + lo).
let reducedHi = 0;
let reducedLo = 0;

/**
 * Reduces x to hi + lo in [-π/4, π/4] and returns the quadrant count n. Three rounds, each
 * taking π/2 in a finer split (pio2_1t = pio2_2 + pio2_2t, pio2_2t = pio2_3 + pio2_3t).
 */
function reduce(x: number): number {
  const fn = Math.round(x * INV_PIO2);
  let r = x - fn * PIO2_1;
  let t = r;
  let w = fn * PIO2_2;
  r = t - w;
  w = fn * PIO2_2T - (t - r - w);
  t = r;
  const w3 = fn * PIO2_3;
  r = t - w3;
  w = fn * PIO2_3T - (t - r - w3);
  reducedHi = r - w;
  reducedLo = r - reducedHi - w;
  return fn;
}

const PIO4 = 0.7853981633974483;

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PIO4) return kernelSin(x, 0);
  const n = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kernelSin(reducedHi, reducedLo);
    case 1:
      return kernelCos(reducedHi, reducedLo);
    case 2:
      return -kernelSin(reducedHi, reducedLo);
    default:
      return -kernelCos(reducedHi, reducedLo);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) <= PIO4) return kernelCos(x, 0);
  const n = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0:
      return kernelCos(reducedHi, reducedLo);
    case 1:
      return -kernelSin(reducedHi, reducedLo);
    case 2:
      return -kernelCos(reducedHi, reducedLo);
    default:
      return kernelSin(reducedHi, reducedLo);
  }
}

// --- atan / atan2 -------------------------------------------------------------------------------

const ATAN_HI = [
  0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966,
] as const;
const ATAN_LO = [
  2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17,
] as const;
const AT = [
  0.3333333333333293, -0.19999999999876483, 0.14285714272503466, -0.11111110405462356,
  0.09090887133436507, -0.0769187620504483, 0.06661073137387531, -0.058335701337905735,
  0.049768779946159324, -0.036531572744216916, 0.016285820115365782,
] as const;

const TWO_66 = 7.378697629483821e19;
const TWO_M27 = 7.450580596923828e-9;
const TWO_60 = 1.152921504606847e18;
const TWO_M60 = 8.673617379884035e-19;

export function atan(value: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  const negative = value < 0 || Object.is(value, -0);
  const ax = Math.abs(value);
  if (ax >= TWO_66) return negative ? -(ATAN_HI[3] + ATAN_LO[3]) : ATAN_HI[3] + ATAN_LO[3];
  let x = value;
  let id = -1;
  if (ax < 0.4375) {
    if (ax < TWO_M27) return value;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      x = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      x = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    x = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    x = -1 / ax;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const result = (ATAN_HI[id as 0] as number) - (x * (s1 + s2) - (ATAN_LO[id as 0] as number) - x);
  return negative ? -result : result;
}

const PI = Math.PI;
const PI_LO = 1.2246467991473532e-16;
const PI_O_2 = 1.5707963267948966;
const PI_O_4 = 0.7853981633974483;

/** atan2(y, x) with the same special cases as `Math.atan2`. */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 1) return atan(y);
  const yNegative = y < 0 || Object.is(y, -0);
  const xNegative = x < 0 || Object.is(x, -0);
  const m = (yNegative ? 1 : 0) | (xNegative ? 2 : 0);

  if (y === 0) {
    if (m < 2) return y; // atan(±0, +anything) = ±0
    return m === 2 ? PI : -PI; // atan(±0, -anything) = ±π
  }
  if (x === 0) return yNegative ? -PI_O_2 : PI_O_2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m] as number;
    }
    return [0, -0, PI, -PI][m] as number;
  }
  if (!Number.isFinite(y)) return yNegative ? -PI_O_2 : PI_O_2;

  const ratio = Math.abs(y / x);
  let z: number;
  if (ratio > TWO_60) {
    z = PI_O_2 + 0.5 * PI_LO;
    return yNegative ? -z : z;
  }
  if (xNegative && ratio < TWO_M60) z = 0;
  else z = atan(ratio);
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

/** √(x² + z²) from exact operations (`Math.sqrt` is correctly rounded everywhere). */
export function hypot(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export const dmath = { sin, cos, atan, atan2, hypot };
