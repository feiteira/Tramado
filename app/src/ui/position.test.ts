import { describe, expect, it } from 'vitest';
import { EDGE, place, pointRect } from './position';

const vp = { width: 1000, height: 700 };
const box = { width: 200, height: 150 };

describe('place', () => {
  it('hangs below the anchor, aligned to its start', () => {
    const p = place({ top: 100, left: 300, width: 80, height: 30 }, box, vp);
    expect(p).toEqual({ top: 136, left: 300, side: 'bottom', maxHeight: 700 - 130 - 6 - EDGE });
  });

  it('flips above when there is no room below but more above', () => {
    const p = place({ top: 650, left: 300, width: 80, height: 30 }, box, vp);
    expect(p.side).toBe('top');
    expect(p.top).toBe(650 - 6 - 150);
  });

  it('stays below when neither side fits but below is roomier, limiting the height', () => {
    const tall = { width: 200, height: 900 };
    const p = place({ top: 200, left: 10, width: 80, height: 30 }, tall, vp);
    expect(p.side).toBe('bottom');
    expect(p.maxHeight).toBe(700 - 230 - 6 - EDGE);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(vp.height - EDGE);
  });

  it('slides along the edge to stay in the window', () => {
    const p = place({ top: 100, left: 950, width: 40, height: 30 }, box, vp);
    expect(p.left).toBe(1000 - 200 - EDGE);
    const q = place({ top: 100, left: -50, width: 40, height: 30 }, box, vp);
    expect(q.left).toBe(EDGE);
  });

  it('aligns to the end or the centre', () => {
    const a = { top: 100, left: 400, width: 100, height: 30 };
    expect(place(a, box, vp, 'bottom', 'end').left).toBe(300);
    expect(place(a, box, vp, 'bottom', 'center').left).toBe(350);
  });

  it('places to the right and flips left at the window edge', () => {
    const r = place({ top: 300, left: 100, width: 50, height: 20 }, box, vp, 'right');
    expect(r).toMatchObject({ side: 'right', left: 156 });
    const l = place({ top: 300, left: 900, width: 50, height: 20 }, box, vp, 'right');
    expect(l).toMatchObject({ side: 'left', left: 900 - 6 - 200 });
  });

  it('works from a right-click point and in a tiny window', () => {
    const p = place(pointRect(990, 690), box, vp);
    expect(p.side).toBe('top');
    expect(p.left).toBe(1000 - 200 - EDGE);
    const tiny = place(pointRect(5, 5), box, { width: 100, height: 60 });
    expect(tiny.left).toBe(EDGE);
    expect(tiny.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
