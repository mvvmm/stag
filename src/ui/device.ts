/**
 * Whether this device can play: the game needs a mouse or trackpad. `any-pointer` (not
 * `pointer`) so a touchscreen laptop or an iPad with a trackpad still counts.
 */
export function deviceSupported(): boolean {
  return matchMedia("(any-pointer: fine)").matches;
}
