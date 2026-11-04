import { describe, expect, it } from 'vitest';
import type { PresenceFile } from '../model/files';
import { hasActivity, PRESENCE_STALE_MS, PresenceTracker } from './presence';

const D = 'AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA';
const file = (seq: number, updatedAt = '2026-11-03T10:00:00.000Z'): PresenceFile => ({
  format: 'tramado.presence', version: 1, deviceId: D, memberId: 'm', seq, hlc: '', updatedAt, power: 'ac',
  activity: { recording: { draftId: '01JBX4Q7Z5W8M2E3C9R6T0YH2K', startedAt: updatedAt, mode: 'room' } }, heartbeatS: 60,
});
const wall = Date.parse('2026-11-03T10:00:00.000Z');

describe('PresenceTracker (sync spec §13)', () => {
  it('stale after 3 minutes without a seq change, on the reader clock', () => {
    const t = new PresenceTracker();
    t.observe(D, file(1), 1000, wall, { connected: true, lastSeenWall: null });
    expect(t.stale(D, 1000 + PRESENCE_STALE_MS - 1)).toBe(false);
    t.observe(D, file(1), 100_000, wall);                       // same seq: no change
    expect(t.stale(D, 1000 + PRESENCE_STALE_MS)).toBe(true);
    t.observe(D, file(2), 200_000, wall);
    expect(t.stale(D, 200_000 + 60_000)).toBe(false);
    expect(t.nextStaleAt(200_000)).toBe(200_000 + PRESENCE_STALE_MS);
  });

  it('seeds a file first seen at start-up from lastSeen when the writer is not connected', () => {
    const t = new PresenceTracker();
    t.observe(D, file(5), 1_000_000, wall, { connected: false, lastSeenWall: wall - 60_000 });
    expect(t.changedAt(D)).toBe(1_000_000 - 60_000);
    const u = new PresenceTracker();
    u.observe(D, file(5), 1_000_000, wall, { connected: false, lastSeenWall: null });
    expect(u.stale(D, 1_000_000)).toBe(true);
  });

  it('ignores activities older than 24 h by updatedAt', () => {
    const t = new PresenceTracker();
    t.observe(D, file(1, '2026-11-01T09:00:00.000Z'), 0, wall);
    expect(t.activity(D, 0, wall)).toBeNull();
    t.observe(D, file(2), 1, wall);
    expect(hasActivity(t.activity(D, 1, wall))).toBe(true);
    expect(hasActivity({})).toBe(false);
  });
});
