import { describe, expect, it } from 'vitest';
import { createThrottle } from './throttle';
import { createTestClock, flush } from './clock.testutil';

describe('throttle (openrouter-lab §8: 18/min for :free, ≤ 3 in flight, interactive before bulk)', () => {
  it('allows at most 3 in flight', async () => {
    const clock = createTestClock();
    const t = createThrottle(clock);
    const started: number[] = [];
    const releases: Array<() => void> = [];
    for (let i = 0; i < 5; i++) void t.acquire({ free: false, priority: 'interactive' }).then((r) => { started.push(i); releases.push(r); });
    await flush();
    expect(started).toEqual([0, 1, 2]);
    expect(t.stats()).toMatchObject({ inFlight: 3, waiting: 2 });
    releases[0]!();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    releases[1]!();
    releases[1]!();   // a second release is a no-op
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(t.stats().inFlight).toBe(3);
  });

  it('starts at most 18 :free requests in any 60 s window', async () => {
    const clock = createTestClock();
    const t = createThrottle(clock);
    let started = 0;
    for (let i = 0; i < 20; i++) void t.acquire({ free: true, priority: 'bulk' }).then((release) => { started++; release(); });
    await flush(100);
    expect(started).toBe(18);
    expect(t.freeInMs()).toBe(60_000);
    await clock.advance(59_999);
    expect(started).toBe(18);
    await clock.advance(1);
    expect(started).toBe(20);
  });

  it('non-free requests are not rate-limited by the free window', async () => {
    const clock = createTestClock();
    const t = createThrottle(clock, { perMinute: 1 });
    const order: string[] = [];
    void t.acquire({ free: true, priority: 'interactive' }).then((r) => { order.push('f1'); r(); });
    void t.acquire({ free: true, priority: 'interactive' }).then((r) => { order.push('f2'); r(); });
    void t.acquire({ free: false, priority: 'interactive' }).then((r) => { order.push('paid'); r(); });
    await flush(50);
    expect(order).toEqual(['f1', 'paid']);
    await clock.advance(60_000);
    expect(order).toEqual(['f1', 'paid', 'f2']);
  });

  it('interactive requests jump ahead of queued bulk ones', async () => {
    const clock = createTestClock();
    const t = createThrottle(clock, { maxInFlight: 1 });
    const order: string[] = [];
    const first = await t.acquire({ free: false, priority: 'bulk' });
    for (const name of ['b1', 'b2']) void t.acquire({ free: false, priority: 'bulk' }).then((r) => { order.push(name); r(); });
    void t.acquire({ free: false, priority: 'interactive' }).then((r) => { order.push('i1'); r(); });
    await flush();
    first();
    await flush(50);
    expect(order).toEqual(['i1', 'b1', 'b2']);
  });

  it('an aborted waiter leaves the queue with CANCELLED', async () => {
    const clock = createTestClock();
    const t = createThrottle(clock, { maxInFlight: 1 });
    const hold = await t.acquire({ free: false, priority: 'interactive' });
    const ac = new AbortController();
    const p = t.acquire({ free: false, priority: 'interactive', signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(t.stats().waiting).toBe(0);
    hold();
  });
});
