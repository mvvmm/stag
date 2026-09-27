/** Fixed simulation rate. Systems only ever see `TICK_DT`, so changing this is a one-line change. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

/** Longest frame delta fed to the loop; longer stalls (breakpoints, hitches) are clamped. */
export const MAX_FRAME_DELTA = 0.25;
/** Most ticks run per frame; past that the leftover time is dropped (slow down instead of freeze). */
export const MAX_TICKS_PER_FRAME = 5;

/** Render resolution cap on high-DPI screens. Becomes a graphics-quality setting later. */
export const MAX_PIXEL_RATIO = 2;

/** Height of the ground plane the cursor is projected onto for aiming. */
export const GROUND_Y = 0;
