import { describe, expect, it } from 'vitest';
import { compareHlc, formatHlc, Hlc, maxHlc, parseHlc, succHlc } from './hlc';

describe('Hlc', () => {
  it('is strictly increasing even when the wall clock stalls or goes back', () => {
    let t = 1000;
    const c = new Hlc('dev1', () => t);
    const a = c.tick();
    const b = c.tick();
    t = 500;
    const d = c.tick();
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, d)).toBe(-1);
  });

  it('moves past stamps it observes from elsewhere', () => {
    const c = new Hlc('aaaa', () => 1000);
    const remote = formatHlc({ ms: 5000, counter: 7, device: 'bbbb' });
    c.observe(remote);
    const next = c.tick();
    expect(compareHlc(next, remote)).toBe(1);
    expect(parseHlc(next).device).toBe('aaaa');
  });

  it('orders by string comparison', () => {
    const early = formatHlc({ ms: 9, counter: 35, device: 'z' });
    const late = formatHlc({ ms: 10, counter: 0, device: 'a' });
    expect(early < late).toBe(true);
  });
});

describe('Hlc (Tramado additions)', () => {
  it('does not observe a stamp more than an hour ahead (folder spec §3.4)', () => {
    let now = 1_000_000;
    const clock = new Hlc('ab4z76w', () => now);
    const ahead = formatHlc({ ms: now + 3_600_001, counter: 0, device: 'tkbnv23' });
    expect(clock.observe(ahead)).toBe('ahead');
    expect(parseHlc(clock.tick()).ms).toBe(now);
    const near = formatHlc({ ms: now + 3_600_000, counter: 3, device: 'tkbnv23' });
    expect(clock.observe(near)).toBe('ok');
    const t = parseHlc(clock.tick());
    expect(t.ms).toBe(now + 3_600_000);
    expect(t.counter).toBe(5);
    now += 1;
  });

  it('round-trips its state and never goes back', () => {
    const a = new Hlc('ab4z76w', () => 10);
    a.tick();
    a.tick();
    expect(a.toState()).toEqual({ ms: 10, counter: 1 });
    const b = new Hlc('ab4z76w', () => 5);
    b.fromState(a.toState());
    expect(b.tick()).toBe(formatHlc({ ms: 10, counter: 2, device: 'ab4z76w' }));
    b.fromState({ ms: 1, counter: 0 });
    expect(parseHlc(b.tick()).ms).toBe(10);
  });

  it('succ and max', () => {
    const h = formatHlc({ ms: 99, counter: 4, device: 'tkbnv23' });
    expect(succHlc(h, 'ab4z76w')).toBe(formatHlc({ ms: 99, counter: 5, device: 'ab4z76w' }));
    expect(maxHlc(h, succHlc(h, 'ab4z76w'))).toBe(succHlc(h, 'ab4z76w'));
  });
});
