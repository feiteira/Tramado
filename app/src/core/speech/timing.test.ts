import { describe, expect, it } from 'vitest';
import { blendSpeed, clock, measuredSpeed, roundedDuration, timeLeft } from './timing';

describe('timeLeft', () => {
  it('extrapolates the rate since the mark', () => {
    // 10 % in 60 s: the remaining 60 % takes 6 minutes.
    expect(timeLeft({ at: 0, percent: 30 }, 40, 60_000)).toBe(360_000);
  });

  it('says nothing too early or once done', () => {
    expect(timeLeft({ at: 0, percent: 0 }, 1, 60_000)).toBeNull();
    expect(timeLeft({ at: 0, percent: 0 }, 20, 10_000)).toBeNull();
    expect(timeLeft({ at: 0, percent: 0 }, 100, 60_000)).toBeNull();
  });
});

describe('measuredSpeed', () => {
  it('is audio time over work time, from a minute of audio up', () => {
    expect(measuredSpeed(3_600_000, 7_200_000)).toBe(0.5);
    expect(measuredSpeed(30_000, 10_000)).toBeNull();
    expect(measuredSpeed(120_000, 0)).toBeNull();
  });

  it('blends with what was known', () => {
    expect(blendSpeed(null, 0.5)).toBe(0.5);
    expect(blendSpeed(1.5, 0.5)).toBe(1);
  });
});

describe('formatting', () => {
  it('writes clock times', () => {
    expect(clock(3_130_000)).toBe('52:10');
    expect(clock(6_005_000)).toBe('1:40:05');
    expect(clock(-5)).toBe('0:00');
  });

  it('rounds durations to minutes, at least one', () => {
    expect(roundedDuration(20_000)).toEqual({ hours: 0, minutes: 1 });
    expect(roundedDuration(5 * 60_000 + 20_000)).toEqual({ hours: 0, minutes: 5 });
    expect(roundedDuration(80 * 60_000)).toEqual({ hours: 1, minutes: 20 });
  });
});
