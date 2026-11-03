import { describe, expect, it } from 'vitest';
import { grownHeight } from './grow';

describe('grownHeight', () => {
  it('settles when the browser reports a pixel more than the box holds (display scale 125%, 150%)', () => {
    // The reported content height is the box height minus the border, rounded up by one pixel.
    const report = (height: number) => height - 2 + 1;
    let h: number | null = null;
    for (let i = 0; i < 60; i++) h = grownHeight(h, report(h ?? 120), 120);
    expect(h).toBeNull();
    h = 200;
    for (let i = 0; i < 60; i++) h = grownHeight(h, report(h ?? 120), 120);
    expect(h).toBe(200);
  });

  it('grows by whole lines, never past the maximum, never below the minimum', () => {
    expect(grownHeight(null, 140.4, 120)).toBe(143);
    expect(grownHeight(143, 162, 120, 150)).toBe(150);
    expect(grownHeight(null, 40, 120)).toBeNull();
  });

  it('shrinks again when the text gets much shorter', () => {
    expect(grownHeight(300, 160, 120)).toBe(162);
  });
});
