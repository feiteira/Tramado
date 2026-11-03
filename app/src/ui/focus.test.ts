import { describe, expect, it } from 'vitest';
import { OpenerTracker, overflowsY } from './focus';

describe('OpenerTracker', () => {
  it('keeps what had the focus when the dialog opened, not the field it focused itself', () => {
    const t = new OpenerTracker<string>();
    let focused = 'merge-button';
    t.update(false, () => focused);
    expect(t.opener).toBeNull();
    t.update(true, () => focused); // render that opens the dialog
    focused = 'codepick-search'; // an autoFocus field inside takes the focus during commit
    t.update(true, () => focused); // later renders while open
    expect(t.opener).toBe('merge-button');
  });

  it('records a new opener each time it opens again', () => {
    const t = new OpenerTracker<string>();
    t.update(true, () => 'a');
    t.update(false, () => 'x');
    t.update(true, () => 'b');
    expect(t.opener).toBe('b');
  });
});

describe('overflowsY', () => {
  it('tells a dialog body that scrolls (and must join the Tab order) from one that fits', () => {
    // The shortcuts dialog at 1000×660: 615 px of content in a 524 px body.
    expect(overflowsY({ scrollHeight: 615, clientHeight: 524 })).toBe(true);
    expect(overflowsY({ scrollHeight: 524, clientHeight: 524 })).toBe(false);
    // Sub-pixel rounding at fractional scales is not overflow.
    expect(overflowsY({ scrollHeight: 525, clientHeight: 524 })).toBe(false);
  });
});
