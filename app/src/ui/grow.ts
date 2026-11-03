/** Pixels a growing field ignores: about the rounding of a fractional display scale, far below a line. */
export const GROW_SLACK = 3;

/**
 * The next height of a field that grows with its text, from the content height the browser just
 * reported (+2 for the border, which that height leaves out). A difference of a few pixels keeps
 * the current height: at a display scale such as 125% or 150% the browser rounds the reported
 * height up, so following it exactly grows the box by a pixel on every render until React gives
 * up. `null` means "the minimum".
 */
export function grownHeight(current: number | null, contentHeight: number, min: number, max = Infinity): number | null {
  const want = Math.min(Math.max(Math.ceil(contentHeight) + 2, min), max);
  return Math.abs(want - (current ?? min)) <= GROW_SLACK ? current : want;
}
