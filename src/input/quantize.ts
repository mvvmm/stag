/**
 * Input values the simulation sees sit on a 1/1024 grid. That keeps replays exact and compact:
 * a recording stores each value as an integer, and playback feeds the sim the very same double.
 */
export const QUANT = 1024;

/** Nearest grid value. `+ 0` turns -0 into 0, since a replay file can't tell them apart. */
export const quantize = (value: number): number => Math.round(value * QUANT) / QUANT + 0;

/** Grid value toward zero, so a quantized direction never gets longer than the original. */
export const quantizeDown = (value: number): number => Math.trunc(value * QUANT) / QUANT + 0;

/** The integer a quantized value is stored as. */
export const toQuantUnits = (value: number): number => Math.round(value * QUANT) + 0;

export const fromQuantUnits = (units: number): number => units / QUANT + 0;
